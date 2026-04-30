"""
URL configuration for planka_tracker project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/6.0/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""

from django.contrib import admin
from django.urls import path, include
from django.urls import re_path
from django.contrib.staticfiles.views import serve as static_serve
from django.views.static import serve as plain_static_serve
from django.conf import settings
from tracker.views import index, login_view, logout_view

urlpatterns = [
    path("admin/", admin.site.urls),
    path("login/", login_view, name="login"),
    path("logout/", logout_view, name="logout"),
    path("api/", include("tracker.urls")),
    path(
        "static/tracker/<path:path>",
        plain_static_serve,
        {"document_root": settings.BASE_DIR / "tracker" / "static" / "tracker"},
    ),
    path("", index, name="index"),
    re_path(r"^static/(?P<path>.*)$", static_serve, {"insecure": True}),
]
