from django.urls import path
from .views import time_summary, user_list

urlpatterns = [
    path("time-summary/", time_summary, name="time-summary"),
    path("users/", user_list, name="user-list"),
]
