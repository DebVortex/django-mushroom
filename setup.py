from distutils.core import setup
from setuptools import find_packages

setup(
    name='django_mushroom',
    version='0.1',
    author='Max Brauer',
    author_email='max@max-brauer.de',
    url='',
    description='A app to run django together with mushroom',
    packages=find_packages(),
    zip_safe=False,
    install_requires=[
        'Django',
        'mushroom',
    ],
    dependency_links=[],
    license='BSD',
    include_package_data=True,
    classifiers=[
        'Development Status :: 3 - Alpha',
        'Framework :: Django',
        'Intended Audience :: Developers',
        'Intended Audience :: System Administrators',
        'License :: OSI Approved :: BSD License',
        'Programming Language :: Python :: 2.7',
        'Topic :: Software Development :: Libraries :: Python Modules',
    ],
)