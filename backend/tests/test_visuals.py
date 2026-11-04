import json

import httpx
import pytest

from todohub import logos
from todohub.categories import categorize
from todohub.config import load_settings


LABEL_TYPES = {"data quality": "analysis", "retraining": "model"}


@pytest.mark.parametrize("title,labels,expected", [
    ("Speed up the nightly job", ["Retraining"], "model"),
    ("Show time-based cross-validation in the interactive report", ["Feature", "Docs"], "code"),
    ("Write up the label leak findings", ["Data quality", "Globex"], "analysis"),
    ("P0.4 Pipeline execution audit", [], "analysis"),
    ("Send Sam the Q1 new-customer file", [], "email"),
    ("Waiting on Pat: lead export", [], "email"),
    ("Review api#812: Export API pagination", [], "review"),
    ("Prep for the Globex call Wed 2:00 PM", [], "meeting"),
    ("Draft the Globex readout deck", [], "writing"),
    ("Retrain the initech propensity model", [], "model"),
    ("Renew the conference badge", [], "admin"),
])
def test_categorize(title, labels, expected):
    assert categorize(title, labels, label_types=LABEL_TYPES) == expected


def test_categorize_by_source():
    assert categorize("Anything", source="github") == "review"
    assert categorize("Anything", signal="meeting_prep") == "meeting"


PNG = b"\x89PNG\r\n\x1a\n" + b"\0" * 200


def test_logo_download_cache_and_miss(tmp_home):
    settings = load_settings()
    calls = []

    def handler(request):
        calls.append(str(request.url))
        if "globex.example" in str(request.url) and "google" in str(request.url):
            return httpx.Response(200, content=PNG)
        if "evil.example" in str(request.url):
            return httpx.Response(200, content=b"<svg onload='x()'></svg>" + b" " * 200)
        return httpx.Response(404, content=b"globe" * 50)

    client = httpx.Client(transport=httpx.MockTransport(handler))
    uri = logos.logo_data_uri(settings, "globex.example", client)
    assert uri.startswith("data:image/png;base64,")
    n = len(calls)
    assert logos.logo_data_uri(settings, "globex.example", client) == uri and len(calls) == n   # cached
    assert logos.logo_data_uri(settings, "evil.example", client) is None                        # SVG refused
    n = len(calls)
    assert logos.logo_data_uri(settings, "evil.example", client) is None and len(calls) == n    # miss remembered


def test_client_domains(tmp_home):
    settings = load_settings()
    assert logos.domains(settings) == {}
    path = tmp_home / "client_domains.json"
    path.write_text(json.dumps({"Hooli": "hooli.example", "Globex": None}))
    assert logos.domains(settings) == {"Hooli": "hooli.example", "Globex": None}
    path.write_text("{not json")
    assert logos.domains(settings) == {}
