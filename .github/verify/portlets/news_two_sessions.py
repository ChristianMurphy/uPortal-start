#!/usr/bin/env python3
"""Renders NewsReader portlets from two sessions of one user at the same moment.

    news_two_sessions.py <label> <out directory> <Tomcat logs directory> <fname> ...

The renders are in edit mode. That render loads the user's news set on the server. The plain
view loads it later, when the browser asks for the feeds, which a script without a browser
doesn't do.

Each round signs student in twice, so there are two new sessions. For each NewsReader portlet,
a third session of student renders it first, which leaves the user's news set in the portlet's
cache. Then the two new sessions request the same portlet at the same moment. That is each
session's first render of the portlet, the render that saves the news set.

The script runs rounds for CHECK_SECONDS seconds (600 by default) and then counts, in the Tomcat
logs, the exceptions with "Illegal attempt to associate a collection with two open sessions".
It also counts the renders that answered 200 without the portlet's own markup. With the label
"after" it exits 1 if it counts any of either. Answers other than 200 are counted by status and
not judged: the portal itself can fail when one user signs in twice in a row.
"""
import http.client
import json
import os
import random
import re
import sys
import threading
import time

HOST, PORT = 'localhost', 8080
USER = 'student'
NEEDLE = 'Illegal attempt to associate a collection with two open sessions'
# One line of each stack trace
TRACE_LINE = 'Caused by: org.hibernate.HibernateException: ' + NEEDLE
# In every page that a NewsReader portlet rendered
MARKUP = 'newsreader-container'


class Client:
    """One keep-alive connection and a cookie jar, as one browser would have."""

    # Without a User-Agent header the portal answers 500 (RemoteCookieCheckFilter)
    HEADERS = {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko)'
                      ' Chrome/140.0.0.0 Safari/537.36 news_two_sessions.py',
        'Accept': 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
    }

    def __init__(self):
        self.conn = http.client.HTTPConnection(HOST, PORT, timeout=120)
        self.cookies = {}  # name -> (value, path)

    def get(self, path):
        """GET path and follow redirects. Returns (status, body)."""
        for _ in range(12):
            headers = dict(self.HEADERS)
            sent = [f'{name}={value}' for name, (value, cookie_path) in self.cookies.items()
                    if path.startswith(cookie_path)]
            if sent:
                headers['Cookie'] = '; '.join(sent)
            try:
                self.conn.request('GET', path, headers=headers)
                resp = self.conn.getresponse()
            except (http.client.HTTPException, OSError):
                self.conn.close()
                self.conn = http.client.HTTPConnection(HOST, PORT, timeout=120)
                self.conn.request('GET', path, headers=headers)
                resp = self.conn.getresponse()
            body = resp.read().decode('utf-8', 'replace')
            for sc in resp.headers.get_all('Set-Cookie') or []:
                name, _, value = sc.split(';', 1)[0].partition('=')
                cookie_path = re.search(r';\s*path=([^;]+)', sc, re.I)
                cookie_path = cookie_path.group(1).strip() if cookie_path else '/'
                if re.search(r';\s*max-age=0\b', sc, re.I):
                    self.cookies.pop(name.strip(), None)
                else:
                    self.cookies[name.strip()] = (value.strip(), cookie_path)
            location = resp.headers.get('Location')
            if resp.status in (301, 302, 303, 307) and location:
                path = re.sub(r'^https?://[^/]+', '', location)
                continue
            return resp.status, body
        raise RuntimeError('too many redirects from ' + path)

    def close(self):
        self.conn.close()


def signed_in():
    client = Client()
    client.get(f'/uPortal/Login?userName={USER}&password={USER}')
    return client


def render(client, fname):
    return client.get(f'/uPortal/p/{fname}/max/render.uP?pCm=edit')


def count_in_logs(logs, needle):
    count = 0
    for root, _, files in os.walk(logs):
        for name in files:
            try:
                with open(os.path.join(root, name), errors='replace') as log:
                    count += sum(1 for line in log if needle in line)
            except OSError:
                pass
    return count


def main():
    label, out, logs = sys.argv[1:4]
    fnames = sys.argv[4:]
    seconds = int(os.environ.get('CHECK_SECONDS', '600'))
    rng = random.Random(int(os.environ.get('CHECK_SEED', '1')))

    # The session that renders first. Its own first renders also create the user's news set.
    first = signed_in()
    usable = [fname for fname in fnames if MARKUP in render(first, fname)[1]]
    traces_at_start = count_in_logs(logs, TRACE_LINE)

    rounds = pairs = without_markup = 0
    not_200 = {}
    sample = other = None
    deadline = time.monotonic() + seconds
    while usable and time.monotonic() < deadline:
        sessions = [signed_in(), signed_in()]
        rounds += 1
        for fname in rng.sample(usable, len(usable)):
            render(first, fname)
            start = threading.Barrier(2)
            answers = [None, None]

            def go(index):
                start.wait()
                answers[index] = render(sessions[index], fname)

            threads = [threading.Thread(target=go, args=(index,)) for index in (0, 1)]
            for thread in threads:
                thread.start()
            for thread in threads:
                thread.join()
            pairs += 1
            for status, body in answers:
                if status != 200:
                    not_200[status] = not_200.get(status, 0) + 1
                    other = other or body
                elif MARKUP not in body:
                    without_markup += 1
                    sample = sample or (fname, body)
        for session in sessions:
            session.close()

    time.sleep(2)  # let the last log lines reach the files
    traces = count_in_logs(logs, TRACE_LINE) - traces_at_start
    result = {
        'label': label,
        'NewsReader portlets': fnames,
        'portlets that rendered for the first session': usable,
        'seconds': seconds,
        'rounds (two new sessions each)': rounds,
        'pairs of renders at the same moment': pairs,
        'renders in those pairs': pairs * 2,
        'renders that did not answer 200, by status': not_200,
        'renders that answered 200 without the portlet markup': without_markup,
        'exceptions in the logs': traces,
        'log lines with the message': count_in_logs(logs, NEEDLE),
        'problems': [],
    }
    if not usable:
        result['problems'].append('no NewsReader portlet rendered')
    if traces or without_markup:
        result['problems'].append('renders failed in the portlet')
    if other:
        with open(f'{out}/render-not-200-{label}.html', 'w') as page:
            page.write(other)
    if sample:
        with open(f'{out}/render-without-markup-{label}.html', 'w') as page:
            page.write(sample[1])
    with open(f'{out}/check-{label}.json', 'w') as report:
        json.dump(result, report, indent=2)
    print(json.dumps(result, indent=2))
    return 1 if label == 'after' and result['problems'] else 0


if __name__ == '__main__':
    sys.exit(main())
