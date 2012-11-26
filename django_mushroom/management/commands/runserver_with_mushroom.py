from optparse import make_option
import os
import re
import sys
import socket

from django.core.management.base import BaseCommand, CommandError
from django.core.servers.basehttp import run, WSGIServerException, get_internal_wsgi_application
from django.utils import autoreload

naiveip_re = re.compile(r"""^(?:
(?P<addr>
    (?P<ipv4>\d{1,3}(?:\.\d{1,3}){3}) |         # IPv4 address
    (?P<ipv6>\[[a-fA-F0-9:]+\]) |               # IPv6 address
    (?P<fqdn>[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*) # FQDN
):)?(?P<port>\d+)$""", re.X)
DEFAULT_PORT = "8000"

from _mushroom_server import _run_mushroom_server

from django.conf import settings
from django.utils import translation

try:
    from django.core.servers.basehttp import AdminMediaHandler
    USE_ADMINMEDIAHANDLER = True
except ImportError:
    USE_ADMINMEDIAHANDLER = False

try:
    from django.contrib.staticfiles.handlers import StaticFilesHandler
    USE_STATICFILES = 'django.contrib.staticfiles' in settings.INSTALLED_APPS
except ImportError, e:
    USE_STATICFILES = False


class BaseRunserverCommand(BaseCommand):
    option_list = BaseCommand.option_list + (
        make_option('--ipv6', '-6', action='store_true', dest='use_ipv6', default=False,
            help='Tells Django to use a IPv6 address.'),
        make_option('--nothreading', action='store_false', dest='use_threading', default=True,
            help='Tells Django to NOT use threading.'),
        make_option('--noreload', action='store_false', dest='use_reloader', default=True,
            help='Tells Django to NOT use the auto-reloader.'),
    )
    if USE_STATICFILES:
        option_list += (
            make_option('--nostatic', action="store_false", dest='use_static_handler', default=True,
                        help='Tells Django to NOT automatically serve static files at STATIC_URL.'),
            make_option('--insecure', action="store_true", dest='insecure_serving', default=False,
                        help='Allows serving static files even if DEBUG is False.'),
        )
    help = "Starts a lightweight Web server for development."
    args = '[optional port number, or ipaddr:port]'

    # Validation is called explicitly each time the server is reloaded.
    requires_model_validation = False

    def get_handler(self, *args, **options):
        """
        Returns the default WSGI handler for the runner.
        """
        return get_internal_wsgi_application()

    def handle(self, addrport='', *args, **options):
        self.use_ipv6 = options.get('use_ipv6')
        if self.use_ipv6 and not socket.has_ipv6:
            raise CommandError('Your Python does not support IPv6.')
        if args:
            raise CommandError('Usage is runserver %s' % self.args)
        self._raw_ipv6 = False
        if not addrport:
            self.addr = ''
            self.port = DEFAULT_PORT
        else:
            m = re.match(naiveip_re, addrport)
            if m is None:
                raise CommandError('"%s" is not a valid port number '
                                   'or address:port pair.' % addrport)
            self.addr, _ipv4, _ipv6, _fqdn, self.port = m.groups()
            if not self.port.isdigit():
                raise CommandError("%r is not a valid port number." % self.port)
            if self.addr:
                if _ipv6:
                    self.addr = self.addr[1:-1]
                    self.use_ipv6 = True
                    self._raw_ipv6 = True
                elif self.use_ipv6 and not _fqdn:
                    raise CommandError('"%s" is not a valid IPv6 address.' % self.addr)
        if not self.addr:
            self.addr = self.use_ipv6 and '::1' or '127.0.0.1'
            self._raw_ipv6 = bool(self.use_ipv6)
        self.run(*args, **options)

    def run(self, *args, **options):
        """
        Runs the server, using the autoreloader if needed
        """
        use_reloader = options.get('use_reloader')
        if use_reloader:
            autoreload.main(self.inner_run, args, options)
        else:

            self.inner_run(*args, **options)

    def inner_run(self, *args, **options):
        threading = options.get('use_threading')
        shutdown_message = options.get('shutdown_message', '')
        quit_command = (sys.platform == 'win32') and 'CTRL-BREAK' or 'CONTROL-C'

        self.stdout.write("Validating models...\n\n")
        self.validate(display_num_errors=True)
        self.mushroom_port = getattr(settings, 'MUSHROOM_PORT', int(self.port) + 100)
        self.stdout.write((
            "Django version %(version)s, using settings %(settings)r\n"
            "Development server is running at http://%(addr)s:%(port)s/\n"
            "Mushroom server is running at http://%(addr)s:%(mushroom_port)s/\n"
            "Quit the server with %(quit_command)s.\n"
        ) % {
            "version": self.get_version(),
            "settings": settings.SETTINGS_MODULE,
            "addr": self._raw_ipv6 and '[%s]' % self.addr or self.addr,
            "port": self.port,
            "mushroom_port": self.mushroom_port,
            "quit_command": quit_command,
        })
        # django.core.management.base forces the locale to en-us. We should
        # set it up correctly for the first request (particularly important
        # in the "--noreload" case).
        translation.activate(settings.LANGUAGE_CODE)

        try:
            handler = self.get_handler(*args, **options)
            if not hasattr(self, 'mushroom_server'):
                self.mushroom_server = _run_mushroom_server(
                    self.addr,
                    self.mushroom_port,
                    settings.INSTALLED_APPS
                )
            run(self.addr, int(self.port), handler,
                ipv6=self.use_ipv6, threading=threading)
        except WSGIServerException, e:
            # Use helpful error messages instead of ugly tracebacks.
            ERRORS = {
                13: "You don't have permission to access that port.",
                98: "That port is already in use.",
                99: "That IP address can't be assigned-to.",
            }
            try:
                error_text = ERRORS[e.args[0].args[0]]
            except (AttributeError, KeyError):
                error_text = str(e)
            sys.stderr.write(self.style.ERROR("Error: %s" % error_text) + '\n')
            # Need to use an OS exit because sys.exit doesn't work in a thread
            os._exit(1)
        except KeyboardInterrupt:
            if shutdown_message:
                self.stdout.write("%s\n" % shutdown_message)
            sys.exit(0)


class Command(BaseRunserverCommand):
    option_list = BaseRunserverCommand.option_list + (
        make_option('--adminmedia', dest='admin_media_path', default='',
            help='Specifies the directory from which to serve admin media.'),
    )

    def get_handler(self, *args, **options):
        """
        Serves admin media like old-school (deprecation pending).
        """
        path = options.get('admin_media_path', '')
        handler = super(Command, self).get_handler(*args, **options)
        if USE_ADMINMEDIAHANDLER:
            handler = AdminMediaHandler(handler, path)
        if USE_STATICFILES:
            use_static_handler = options.get('use_static_handler', True)
            insecure_serving = options.get('insecure_serving', False)
            if use_static_handler and (settings.DEBUG or insecure_serving):
                handler = StaticFilesHandler(handler)
        return handler
