django-mushroom
===============

django-mushroom is a django app that make it possible to use [mushroom](https://bitbucket.org/terreon/mushroom "mushroom") in your django projects. The project [django_mushroom_example](https://github.com/DebVortex/django_mushroom_example "django_mushroom_example") gives you an "living example" how to use it.

How to use
----------

Just install it with *python setup.py install* and add it to your installed apps. To use it, you have to patch your manage.py. To do this, add the following 2 lines at the top your your manage.py:

*from gevent import monkey*
*monkey.patch_all()*

Now you can add a mushroom.py to your apps and specify rpc_functions or scheduled_functions. To do so, use the *rpc_function* or the *scheduled_function* decorator you can import from *django-mushroom.utils*. 

You can start the server by running *python manage.py runserver_with_mushroom*. At the moment, there is just a modified runserver command but other commands like runfcgi will follow.

During the start, a mushroom-server is spawned to at the port *django-port*+100 (or as specified as *MUSHROOM_PORT* in the settings.py). The functions are added via metaprogramming to the server an can be called via a RPC request.