import uuid

from django.contrib.sessions.backends.db import SessionStore as DBSessionStore


class SessionStore(DBSessionStore):
    def _get_new_session_key(self):
        while True:
            session_key = uuid.uuid4().hex
            if not self.exists(session_key):
                return session_key
