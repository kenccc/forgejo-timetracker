from django.urls import path
from .views import time_summary

urlpatterns = [
    path("time-summary/", time_summary, name="time-summary"),
]
