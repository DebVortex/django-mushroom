from django.utils.importlib import import_module

from gevent.pywsgi import WSGIServer
from geventwebsocket import WebSocketHandler

import mushroom
from mushroom.http import HttpResponse

import gevent

from types import MethodType

import logging


class BaseServer(WSGIServer):

    def __init__(self, listener, rpc_handler=None,
            auth_handler=None, disconnect_handler=None):
        super(BaseServer, self).__init__(listener,
                MushroomApplication(rpc_handler,
                    auth_handler, disconnect_handler),
                handler_class=WebSocketHandler)

    @property
    def sessions(self):
        return self.application.sessions


class MushroomServer(BaseServer):

    def __init__(self, listener, module_names_list):
        super(MushroomServer, self).__init__(listener,
                mushroom.MethodDispatcher(self, 'rpc_'))
        self.scheduled_functions = []
        self._set_rpc_and_scheduled_functions(module_names_list)
        for function in self.scheduled_functions:
            gevent.spawn(getattr(self, function))

    def _set_rpc_and_scheduled_functions(self, module_names_list):
        """
        """
        for module_name in module_names_list:
            try:
                mushroom_functions = import_module('.mushroom', module_name)
                for func_name in dir(mushroom_functions):
                    func = getattr(mushroom_functions, func_name)
                    add_func = False
                    if hasattr(func, 'rpc_function'):
                        func_name = 'rpc_%s_%s' % (module_name, func_name)
                        add_func = True
                    if hasattr(func, 'scheduled_function'):
                        func_name = 'scheduled_%s_%s' % (module_name, func_name)
                        add_func = True
                        self.scheduled_functions.append(func_name)
                    if add_func:
                        func.func_name = func_name
                        setattr(
                            self,
                            func_name,
                            MethodType(func, self)
                        )
            except ImportError:
                pass


class MushroomApplication(mushroom.Application):

    def __init__(self, rpc_handler=None,
            auth_handler=None, disconnect_handler=None):
        super(MushroomApplication, self).__init__(rpc_handler,
                auth_handler, disconnect_handler)

    def request(self, request):
        if request.method == 'OPTIONS':
            ex_headers = {
                'Access-Control-Request-Method': 'POST',
                'Access-Control-Allow-Origin': '*',
            }
            return HttpResponse(extra_headers=ex_headers)
        return super(MushroomApplication, self).request(request)


def _run_mushroom_server(addr, port, INSTALLED_APPS):
    """
    """
    logging.basicConfig()
    mushroom_listener = (addr, port)
    server = MushroomServer(mushroom_listener, INSTALLED_APPS)
    import gevent
    return gevent.spawn(server.serve_forever)
