#!/usr/bin/env python3
"""Submit the PVHOT homepage and latest article URLs to Baidu.

The Baidu token is intentionally accepted only through the process environment.
This module never prints request URLs or upstream exception messages because the
API requires the token to be carried in the request query string.
"""

import base64
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


BAIDU_SITE = "https://pvhot.bbroot.com"
SITE_URL = BAIDU_SITE + "/"
# Baidu's official ordinary-submission endpoint currently uses HTTP. The
# credential is appended only at request time and is never logged.
BAIDU_API_ENDPOINT = "http://data.zz.baidu.com/urls"
DEFAULT_ROOT = "/var/www/pvhot/current"
LATEST_LIMIT = 9
REQUEST_TIMEOUT_SECONDS = 20
MAX_RESPONSE_BYTES = 64 * 1024


class BaiduPushError(RuntimeError):
    """A sanitized failure that is safe to display in service logs."""


class BaiduQuotaExhausted(BaiduPushError):
    """The daily submission quota was already consumed."""


class BaiduSiteUnavailable(BaiduPushError):
    """The configured site is not currently verified by Baidu."""


def load_data(root):
    """Load and validate PVHOT data.json from *root*."""
    data_path = Path(root) / "data.json"
    try:
        with data_path.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
    except FileNotFoundError:
        raise BaiduPushError("data.json was not found under PVHOT_ROOT") from None
    except PermissionError:
        raise BaiduPushError("data.json is not readable under PVHOT_ROOT") from None
    except json.JSONDecodeError as error:
        raise BaiduPushError(
            "data.json is invalid JSON at line {}, column {}".format(
                error.lineno,
                error.colno,
            )
        ) from None
    except OSError:
        raise BaiduPushError("data.json could not be read") from None

    if not isinstance(data, dict) or not isinstance(data.get("items"), list):
        raise BaiduPushError("data.json must contain an items array")
    return data


def _item_date(item):
    if not isinstance(item, dict):
        return ""
    return str(item.get("pubDate") or item.get("dateKey") or "")


def _item_public_url(value):
    if not isinstance(value, str):
        return None
    value = value.strip()
    if (
        not value
        or len(value) > 256
        or any(ord(character) < 32 for character in value)
    ):
        return None
    try:
        encoded = base64.urlsafe_b64encode(value.encode("utf-8")).decode("ascii").rstrip("=")
    except (UnicodeError, ValueError):
        return None
    return "{}api/v1/articles/{}/".format(SITE_URL, encoded)


def build_submission_urls(data, latest_limit=LATEST_LIMIT):
    """Return the homepage followed by up to *latest_limit* PVHOT item URLs."""
    items = data.get("items", []) if isinstance(data, dict) else []
    latest_limit = max(0, int(latest_limit))
    ordered = sorted(
        enumerate(items),
        key=lambda pair: (_item_date(pair[1]), -pair[0]),
        reverse=True,
    )

    urls = [SITE_URL]
    if latest_limit == 0:
        return urls
    seen = {SITE_URL}
    for _, item in ordered:
        item_url = _item_public_url(item.get("id") if isinstance(item, dict) else None)
        if not item_url or item_url in seen:
            continue
        urls.append(item_url)
        seen.add(item_url)
        if len(urls) - 1 >= latest_limit:
            break
    return urls


def _request_for(token, urls):
    query = urllib.parse.urlencode({"site": BAIDU_SITE, "token": token})
    payload = ("\n".join(urls) + "\n").encode("utf-8")
    return urllib.request.Request(
        "{}?{}".format(BAIDU_API_ENDPOINT, query),
        data=payload,
        headers={
            "Content-Type": "text/plain; charset=utf-8",
            "User-Agent": "PVHOT-BaiduPush/1.0",
        },
        method="POST",
    )


def submit_urls(token, urls, opener=None):
    """Submit URLs and return the decoded API response without leaking *token*."""
    request = _request_for(token, urls)
    open_request = opener or urllib.request.urlopen
    try:
        with open_request(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
            body = response.read(MAX_RESPONSE_BYTES + 1)
    except urllib.error.HTTPError as error:
        try:
            body = error.read(MAX_RESPONSE_BYTES + 1)
            result = json.loads(body.decode("utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError):
            result = None
        if isinstance(result, dict):
            upstream_code = result.get("error")
            upstream_message = str(result.get("message") or "").strip().lower()
            if upstream_code == 400 and upstream_message == "over quota":
                raise BaiduQuotaExhausted(
                    "Baidu daily submission quota is already exhausted"
                ) from None
            if upstream_code == 400 and upstream_message in {
                "site error",
                "site init fail",
            }:
                raise BaiduSiteUnavailable(
                    "Baidu site verification is unavailable"
                ) from None
            if isinstance(upstream_code, int):
                raise BaiduPushError(
                    "Baidu API returned HTTP status {} (error code {})".format(
                        error.code,
                        upstream_code,
                    )
                ) from None
        raise BaiduPushError(
            "Baidu API returned HTTP status {}".format(error.code)
        ) from None
    except (urllib.error.URLError, TimeoutError):
        raise BaiduPushError("Baidu API request failed due to a network error") from None
    except Exception:
        # Upstream exceptions can contain Request.full_url, which contains the
        # token required by Baidu. Never forward the original message.
        raise BaiduPushError("Baidu API request failed unexpectedly") from None

    if len(body) > MAX_RESPONSE_BYTES:
        raise BaiduPushError("Baidu API response exceeded the safe size limit")
    try:
        result = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise BaiduPushError("Baidu API returned an invalid JSON response") from None
    if not isinstance(result, dict):
        raise BaiduPushError("Baidu API returned an unexpected response")
    if "error" in result:
        code = result.get("error")
        if isinstance(code, int):
            raise BaiduPushError(
                "Baidu API rejected the request with error code {}".format(code)
            )
        raise BaiduPushError("Baidu API rejected the request")
    return result


def _count_rejected(value):
    if isinstance(value, list):
        return len(value)
    if isinstance(value, int) and value >= 0:
        return value
    return 0


def _safe_nonnegative_int(value):
    return value if isinstance(value, int) and value >= 0 else 0


def run(environ=None, stdout=None, stderr=None, opener=None):
    """Run one push operation and return a process-style status code."""
    environment = os.environ if environ is None else environ
    output = sys.stdout if stdout is None else stdout
    errors = sys.stderr if stderr is None else stderr

    token = str(environment.get("PVHOT_BAIDU_TOKEN", "")).strip()
    if not token:
        print(
            "[bd_push] configuration error: PVHOT_BAIDU_TOKEN is not configured",
            file=errors,
        )
        return 2

    root = environment.get("PVHOT_ROOT") or DEFAULT_ROOT
    try:
        data = load_data(root)
        urls = build_submission_urls(data)
    except BaiduPushError as error:
        print("[bd_push] data error: {}".format(error), file=errors)
        return 2

    latest_count = max(0, len(urls) - 1)
    if environment.get("PVHOT_BAIDU_DRY_RUN") == "1":
        print(
            "[bd_push] dry-run: prepared {} URL(s) "
            "(homepage=1, latest={}); network disabled".format(
                len(urls),
                latest_count,
            ),
            file=output,
        )
        return 0

    try:
        result = submit_urls(token, urls, opener=opener)
    except BaiduQuotaExhausted:
        print(
            "[bd_push] quota already exhausted; no additional URLs submitted",
            file=output,
        )
        return 0
    except BaiduSiteUnavailable as error:
        print("[bd_push] configuration error: {}".format(error), file=errors)
        return 2
    except BaiduPushError as error:
        print("[bd_push] push failed: {}".format(error), file=errors)
        return 1

    accepted = _safe_nonnegative_int(result.get("success"))
    remaining = _safe_nonnegative_int(result.get("remain"))
    rejected = (
        _count_rejected(result.get("not_same_site"))
        + _count_rejected(result.get("not_valid"))
    )
    print(
        "[bd_push] push complete: submitted={}, accepted={}, "
        "rejected={}, remaining={}".format(
            len(urls),
            accepted,
            rejected,
            remaining,
        ),
        file=output,
    )
    return 0


def main():
    return run()


if __name__ == "__main__":
    sys.exit(main())
