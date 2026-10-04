"""Public settings shared by navigation, retention and deployment invalidation."""
import hashlib
import json
import os
from pathlib import Path
import re
import sys
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo

KEYS = (
    'SITE_BRAND', 'SITE_BRAND_PREFIX', 'SITE_BADGE', 'SITE_TITLE',
    'SITE_DESCRIPTION', 'SITE_HOME_LABEL', 'SITE_FOOTER_TEXT',
    'SITE_FILES_LABEL', 'SITE_FILES_URL', 'SITE_ARTICLES_DESCRIPTION',
    'SITE_INCIDENTS_DESCRIPTION', 'SITE_HEALTH_DESCRIPTION', 'SITE_HEALTH_INTRO',
    'SITE_REPORTS_DESCRIPTION', 'SITE_REPORTS_INTRO', 'SITE_DIRECTORY_DESCRIPTION',
    'SITE_SITEMAP_DESCRIPTION', 'REPORTS_HEALTH_PREFIX', 'REPORTS_TIMEZONE',
    'REPORTS_WEEKLY_KEEP',
)


def load():
    defaults = json.loads((Path(__file__).resolve().parent.parent / 'site.config.json').read_text())
    if set(defaults) != set(KEYS):
        raise ValueError('site.config.json must contain exactly the documented settings')
    settings = {key: os.environ.get(key, defaults[key]) for key in KEYS}
    for key in KEYS:
        if key != 'REPORTS_WEEKLY_KEEP' and not isinstance(settings[key], str):
            raise ValueError(f'{key} must be text')
    limit = str(settings['REPORTS_WEEKLY_KEEP'])
    if not re.fullmatch(r'[0-9]+', limit) or not 1 <= int(limit) <= 100:
        raise ValueError('REPORTS_WEEKLY_KEEP must be an integer from 1 to 100')
    settings['REPORTS_WEEKLY_KEEP'] = int(limit)
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]*', settings['REPORTS_HEALTH_PREFIX']):
        raise ValueError('REPORTS_HEALTH_PREFIX must be a filename prefix, not a path')
    try:
        ZoneInfo(settings['REPORTS_TIMEZONE'])
    except (KeyError, ValueError) as error:
        raise ValueError('REPORTS_TIMEZONE must be an IANA timezone') from error
    url = settings['SITE_FILES_URL']
    if url and not (url.startswith('/') and not url.startswith('//') or
                    urlsplit(url).scheme in ('http', 'https') and urlsplit(url).netloc):
        raise ValueError('SITE_FILES_URL must be empty, a root-relative URL, or HTTP(S)')
    return settings


if __name__ == '__main__' and sys.argv[1:] == ['--env-hash']:
    # Never fingerprint unrelated environment or render secrets into output.
    data_keys = ('LAB_CONFIG', 'LAB_SNAPSHOT', 'LAB_PREVIOUS')
    overrides = {key: os.environ[key] for key in (*KEYS, *data_keys) if key in os.environ}
    for key in data_keys:
        if key in os.environ:
            path = Path(os.environ[key])
            if path.is_file():
                overrides[key + '_hash'] = hashlib.sha256(path.read_bytes()).hexdigest()
    print(hashlib.sha256(json.dumps(overrides, sort_keys=True).encode()).hexdigest()
          if overrides else '')
