from django.urls import path
from .views import time_summary,index

urlpatterns = [
    path("", index),
    path("time-summary/", time_summary),   
]