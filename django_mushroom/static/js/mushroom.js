function getCookie(name) {
    var nameEQ = name + "=";
    var ca = document.cookie.split(';');
    for(var i = 0; i < ca.length; i++) {
        var c = ca[i];
        while (c.charAt(0) == ' ') c = c.substring(1, c.length);
        if (c.indexOf(nameEQ) === 0) return c.substring(nameEQ.length, c.length);
    }
    return null;
}

(function(undefined) {

var mushroom = window.mushroom;
if (mushroom === undefined) {
	mushroom = window.mushroom = {};
}

function Signal() {
	this.handlers = [];
}

Signal.prototype.send = function() {
	var args = arguments;
	this.handlers.forEach(function(handler) {
		handler.apply(this, args);
	}.bind(this));
};

Signal.prototype.connect = function(handler) {
	this.handlers.push(handler);
};

Signal.prototype.disconnect = function(handler) {
	var index = this.handlers.indexOf(handler);
	if (index !== -1) {
		this.handlers.splice(index, 1);
	}
};

Signal.prototype.disconnectAll = function() {
	this.handlers.splice(0);
};

function createXHR() {
	try {
		return new window.XMLHttpRequest();
	} catch(e) {}
	try {
		return new window.ActiveXObject('Microsoft.XMLHTTP');
	} catch(e) {}
}

var WEB_SOCKET_SUPPORT = 'WebSocket' in window;

function post(url, data, callback) {
	var xhr = createXHR();
	xhr.open('POST', url, true);
	xhr.onreadystatechange = function() {
		if (xhr.readyState === 4) {
			callback(xhr);
		}
	};
	/* In order to make so called 'simple requests' that work via CORS
     * the Content-Type is very limited. We simply use text/plain which
     * is better than using form-data content types.
     * https://developer.mozilla.org/en/http_access_control#Simple_requests
     */
	if (data !== null) {
		xhr.setRequestHeader('Content-Type', 'text/plain');
		console.log(JSON.stringify(data));
		xhr.send(JSON.stringify(data));
	} else {
		xhr.send(null);
	}
}

mushroom.Client = function(options) {
	this.url = options.url;
	this.transports = options.transports ||
			(WEB_SOCKET_SUPPORT ? ['ws', 'poll'] : ['poll']);
	this.transport = null;
	this.messages = [];
	this.methods = options.methods || {};
	this.lastMessageId = -1;
	this.requests = {};

	this.signals = {
		// This signal is sent when a request returns an error and
		// no errorCallback was specified.
		error: new Signal(),
		// This signal is sent when the connection is established.
		connected: new Signal(),
		// This signal is sent when the connection was terminated.
		disconnected: new Signal()
	};

	// FIXME this requires jQuery
	/*
	$(window).bind('beforeunload', function() {
		// FIXME It seams that this call should be done asynchroneously
		//       which might not work for cross domain requests at all.
		//       We need to find a good solution here or use a shorter
		//       timeout value in order to detect disconnects earlier at
		//       the server side.
		this.disconnect();
	}.bind(this));
	*/
};

mushroom.Client.prototype.nextMessageId = function() {
	this.lastMessageId += 1;
	return this.lastMessageId;
};

mushroom.Client.prototype.connect = function(auth) {
	var request = {
		transports: this.transports,
		auth: auth || null
	};
	post(this.url, request, function(xhr) {
		// FIXME check status code
		jsonResponse = JSON.parse(xhr.responseText);
		transportClass = mushroom.transports[jsonResponse.transport];
		if (transportClass === undefined) {
			throw Error('Unsupported transport ' + this.transport);
		}
		this.transport = new transportClass(this, jsonResponse);
		this.transport.start();
	}.bind(this));
};

mushroom.Client.prototype.disconnect = function() {
	// FIXME check current state of transport
	this.sendMessage(new mushroom.Disconnect({}));
};

mushroom.Client.prototype.method = function(name, callback) {
	this.methods[name] = callback;
	return this;
};

mushroom.Client.prototype.notify = function(method, data) {
	this.sendMessage(new mushroom.Notification({
		messageId: this.nextMessageId(),
		method: method,
		data: data
	}));
};

/**
 * Retrieve request object from requests object while
 * removing it from there. This method is used to retrieve
 * the request object when receiving a response or error.
 */
mushroom.Client.prototype.popRequest = function(id) {
	var request = this.requests[id];
	delete this.requests[id];
	return request;
};

mushroom.Client.prototype.request = function(method, data, responseCallback, errorCallback) {
	if (responseCallback === undefined) {
		throw Error("responseCallback is mandatory");
	}
	if (errorCallback === undefined) {
		// Fall back to global error signal if no errorCallback is given
		errorCallback = function(error) {
			this.signals.error.send({
				request: message,
				error: error
			});
		}.bind(this);
	}
	var request = new mushroom.Request({
		messageId: this.nextMessageId(),
		method: method,
		data: data,
		responseCallback: responseCallback,
		errorCallback: errorCallback
	});
	this.requests[request.messageId] = request;
	this.sendMessage(request);
};

mushroom.Client.prototype.sendMessage = function(message) {
	this.messages.push(message);
	if (this.transport !== null && this.transport.connected) {
		this.transport.sendMessage(message);
	}
};

mushroom.Client.prototype.handleNotification = function(notification) {
	var method = this.methods[notification.method];
	if (method !== undefined) {
		method.call(this, notification);
	} else {
		// FIXME Add logging that does not cause errors on browsers without
		//       developer tools.
		console.log('No method for notification: ' + notification.method);
	}
};

mushroom.Client.prototype.handleResponse = function(response) {
	var request = this.popRequest(response.requestMessageId);
	request.responseCallback(response.data);
};

mushroom.Client.prototype.handleError = function(error) {
	var request = this.popRequest(error.requestMessageId);
	request.errorCallback(error.data);
};

mushroom.Client.prototype.handleDisconnect = function() {
	this.transport = null;
	this.signals.disconnected.send();
};

mushroom.PollTransport = function(client, options) {
	this.client = client;
	this.url = options.url;
	this.lastMessageId = null;
	this.running = false;
	this.stopping = false;
	this.connected = false;
};

mushroom.PollTransport.prototype.start = function() {
	if (this.running) {
		throw Error('Already started');
	}
	this.poll();
};

mushroom.PollTransport.prototype.poll = function() {
	this.running = true;
	this.connected = true;
	this.client.signals.connected.send();
	var request = [
		[0, this.lastMessageId]
	];
	post(this.url, request, function(xhr) {
		if (xhr.status !== 200) {
			this.running = false;
			this.stopping = false;
			this.connected = false;
			this.client.handleDisconnect();
			return;
		}
		data = JSON.parse(xhr.responseText);
		data.forEach(function(messageData) {
			var message = mushroom.messageFromData(messageData);
			if ('messageId' in message) {
				if (message.messageId <= this.lastMessageId &&
						this.lastMessageId !== null) {
					// skip messages which we have already processed
					return;
				}
				this.lastMessageId = message.messageId;
			}
			message_name = message.constructor.MESSAGE_NAME;
			var handler = this.client['handle' + message_name];
			handler.call(this.client, message);
		}.bind(this));
		if (this.stopping) {
			this.stopping = false;
			this.running = false;
		} else {
			this.poll();
		}
	}.bind(this));
};

mushroom.PollTransport.prototype.sendMessage = function(message) {
	var request = [
		message.toList()
	];
	post(this.url, request, function(xhr) {
		// FIXME remove message from out-queue
	});
};

mushroom.WebSocketTransport = function(client, options) {
	this.client = client;
	this.url = options.url;
	this.connected = false;
};

mushroom.WebSocketTransport.prototype.start = function() {
	this.ws = new WebSocket(this.url);
	this.ws.onopen = function(event) {
		this.connected = true;
		this.client.signals.connected.send();
		this.client.messages.forEach(this.sendMessage.bind(this));
	}.bind(this);
	this.ws.onclose = function(event) {
		this.connected = false;
		this.client.handleDisconnect();
	}.bind(this);
	this.ws.onmessage = function(event) {
		frame = event.data;
		messageData = JSON.parse(frame);
		message = mushroom.messageFromData(messageData);
		if ('messageId' in message) {
			if (message.messageId <= this.lastMessageId &&
					this.lastMessageId !== null) {
				// skip messages which we have already processed
				return;
			}
			this.lastMessageId = message.messageId;
		}
		message_name = message.constructor.MESSAGE_NAME;
		var handler = this.client['handle' + message_name];
		handler.call(this.client, message);
	}.bind(this);
};

mushroom.WebSocketTransport.prototype.sendMessage = function(message) {
	// FIXME queue messages and wait for acknowledgement
	var data = message.toList();
	var frame = JSON.stringify(data);
	this.ws.send(frame);
};

mushroom.transports = {
	'poll': mushroom.PollTransport,
	'ws': mushroom.WebSocketTransport
};

mushroom.Notification = function(options) {
	this.client = options.client;
	this.messageId = options.messageId;
	this.method = options.method;
	this.data = options.data;
};

mushroom.Notification.prototype.isRequest = false;

mushroom.Notification.MESSAGE_CODE = 1;
mushroom.Notification.MESSAGE_NAME = 'Notification';

mushroom.Notification.prototype.toList = function() {
	return [mushroom.Notification.MESSAGE_CODE, this.messageId,
			this.method, this.data];
};

mushroom.Request = function(options) {
	this.client = options.client;
	this.messageId = options.messageId;
	this.method = options.method;
	this.data = options.data || null;
	this.responseCallback = options.responseCallback;
	this.errorCallback = options.errorCallback;
};

mushroom.Request.prototype.isRequest = true;

mushroom.Request.fromList = function() {
	// XXX
};

mushroom.Request.MESSAGE_CODE = 2;
mushroom.Request.MESSAGE_NAME = 'Request';

mushroom.Request.prototype.toList = function() {
	return [mushroom.Request.MESSAGE_CODE, this.messageId,
			this.method, this.data];
};

mushroom.Request.prototype.sendResponse = function(data) {
	var response = new mushroom.Response({
		client: this.client,
		messageId: this.client.nextMessageId(),
		requestMessageId: this.messageId,
		data: data
	});
	this.client.sendMessage(response);
};

mushroom.Request.prototype.sendError = function(data) {
	var error = new mushroom.Error({
		client: this.client,
		messageId: this.client.nextMessageId(),
		requestMessageId: this.messageId,
		data: data
	});
	this.client.sendMessage(error);
};

mushroom.Response = function(options) {
	this.client = options.client;
	this.messageId = options.messageId;
	this.requestMessageId = options.requestMessageId;
	this.data = options.data || null;
};

mushroom.Response.MESSAGE_CODE = 3;
mushroom.Response.MESSAGE_NAME = 'Response';

mushroom.Response.prototype.success = true;

mushroom.Error = function(options) {
	this.client = options.client;
	this.messageId = options.messageId;
	this.requestMessageId = options.requestMessageId;
	this.data = options.data || null;
};

mushroom.Error.MESSAGE_CODE = 4;
mushroom.Error.MESSAGE_NAME = 'Error';

mushroom.Error.prototype.success = false;

mushroom.Error.prototype.toList = function() {
	return [mushroom.Error.MESSAGE_CODE, this.messageId,
			this.requestMessageId, this.data];
};

mushroom.Disconnect = function(options) {
	this.client = options.client;
};

mushroom.Disconnect.MESSAGE_CODE = -1;
mushroom.Disconnect.MESSAGE_NAME = -1;

mushroom.Disconnect.prototype.toList = function() {
	return [mushroom.Disconnect.MESSAGE_CODE];
};

mushroom.messageFromData = function(data) {
	switch (data[0]) {
		case 0: // heartbeat
			// FIXME implement support for heartbeats
			throw Error('FIXME');
		case 1: // notification
			return new mushroom.Notification({
				client: this,
				messageId: data[1],
				method: data[2],
				data: data[3]
			});
		case 2: // request
			// FIXME implement support for requests
			throw Error('FIXME');
		case 3: // response
			return new mushroom.Response({
				client: this,
				messageId: data[1],
				requestMessageId: data[2],
				data: data[3]
			});
		case 4: // error
			return new mushroom.Error({
				client: this,
				messageId: data[1],
				requestMessageId: data[2],
				data: data[3]
			});
		case -1: // disconnect
			return new mushroom.Disconnect({
				client: this
			});
		default:
			throw Error('Unsupported message code: ' + data[0]);
	}
};

})();

