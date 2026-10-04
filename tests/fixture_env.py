"""Keep fixture tests independent of the operator's imported .env."""
import os

def reset():
    for key in list(os.environ):
        if key.startswith(('SITE_', 'REPORTS_', 'LAB_')):
            os.environ.pop(key)
