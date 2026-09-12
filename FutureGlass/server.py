import json
import math
import os
import re
import threading
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor, as_completed
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


ROOT = os.path.dirname(os.path.abspath(__file__))
USER_AGENT = "FutureGlass/1.0 local-news prototype"
NEWS_CACHE = {}
NEWS_CACHE_LOCK = threading.Lock()
CACHE_TTL_SECONDS = 15 * 60


def fetch_json(url):
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=12) as response:
        return json.load(response)


def fetch_text(url):
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=12) as response:
        return response.read()


PREFERENCE_TERMS = {
    "public_safety": '"public safety" OR emergency OR fire OR police',
    "weather": "weather OR environment OR climate",
    "transport": "traffic OR transit OR transportation",
    "community": "community OR government OR schools",
    "business": "business OR economy OR development",
    "technology": "technology OR science",
    "culture": "arts OR culture OR food OR events",
}


def destination_point(latitude, longitude, distance_miles, bearing_degrees):
    angular_distance = distance_miles / 3958.8
    bearing = math.radians(bearing_degrees)
    latitude_radians = math.radians(latitude)
    longitude_radians = math.radians(longitude)
    destination_latitude = math.asin(
        math.sin(latitude_radians) * math.cos(angular_distance)
        + math.cos(latitude_radians) * math.sin(angular_distance) * math.cos(bearing)
    )
    destination_longitude = longitude_radians + math.atan2(
        math.sin(bearing) * math.sin(angular_distance) * math.cos(latitude_radians),
        math.cos(angular_distance) - math.sin(latitude_radians) * math.sin(destination_latitude),
    )
    return math.degrees(destination_latitude), ((math.degrees(destination_longitude) + 540) % 360) - 180


def reverse_location(latitude, longitude):
    reverse_url = "https://api.bigdatacloud.net/data/reverse-geocode-client?" + urllib.parse.urlencode({
        "latitude": latitude,
        "longitude": longitude,
        "localityLanguage": "en",
    })
    location = fetch_json(reverse_url)
    location["_sampleLatitude"] = latitude
    location["_sampleLongitude"] = longitude
    return location


def fetch_locality_stories(location, preferences):
    city = location.get("city") or location.get("locality") or "local"
    region = location.get("principalSubdivision") or ""
    country_code = location.get("countryCode") or "US"
    if len(preferences) == len(PREFERENCE_TERMS):
        topic_query = "local news"
    else:
        topic_query = "(" + " OR ".join(PREFERENCE_TERMS[preference] for preference in preferences) + ")"
    query = f"{city} {region} local {topic_query} when:2d"
    rss_url = "https://news.google.com/rss/search?" + urllib.parse.urlencode({
        "q": query,
        "hl": "en-US",
        "gl": country_code,
        "ceid": f"{country_code}:en",
    })
    root = ET.fromstring(fetch_text(rss_url))
    stories = []
    for item in root.findall("./channel/item")[:10]:
        source = item.find("source")
        stories.append({
            "title": item.findtext("title", "").strip(),
            "url": item.findtext("link", "").strip(),
            "published": item.findtext("pubDate", "").strip(),
            "source": (source.text or "Unknown publisher").strip() if source is not None else "Unknown publisher",
            "sourceUrl": source.get("url", "") if source is not None else "",
            "latitude": location["_sampleLatitude"],
            "longitude": location["_sampleLongitude"],
            "location": f"{city}, {region}" if region else city,
            "locationPrecision": "Locality-level anchor derived from the regional news query; the source feed does not provide exact story coordinates.",
        })
    return stories


def get_local_news(latitude, longitude, preferences):
    cache_key = (round(latitude, 1), round(longitude, 1), tuple(sorted(preferences)))
    with NEWS_CACHE_LOCK:
        cached = NEWS_CACHE.get(cache_key)
        if cached and time.time() - cached["created"] < CACHE_TTL_SECONDS:
            return cached["payload"]

    sample_points = [(latitude, longitude)]
    for distance in (100, 220):
        sample_points.extend(destination_point(latitude, longitude, distance, bearing) for bearing in range(0, 360, 60))

    localities = []
    with ThreadPoolExecutor(max_workers=8) as executor:
        futures = [executor.submit(reverse_location, sample_lat, sample_lon) for sample_lat, sample_lon in sample_points]
        for future in as_completed(futures):
            try:
                localities.append(future.result())
            except Exception:
                continue

    unique_localities = {}
    for location in localities:
        city = location.get("city") or location.get("locality")
        region = location.get("principalSubdivision") or ""
        country = location.get("countryCode") or ""
        if city:
            unique_localities.setdefault((city.casefold(), region.casefold(), country), location)

    candidates = []
    with ThreadPoolExecutor(max_workers=8) as executor:
        futures = [
            executor.submit(fetch_locality_stories, location, preferences)
            for location in unique_localities.values()
        ]
        for future in as_completed(futures):
            try:
                candidates.extend(future.result())
            except Exception:
                continue

    stories = []
    source_counts = {}
    title_tokens = []
    for candidate in candidates:
        source_key = candidate["source"].casefold()
        tokens = set(re.findall(r"[a-z0-9]+", candidate["title"].casefold())) - {
            "a", "an", "and", "at", "for", "from", "in", "of", "on", "the", "to", "with",
        }
        is_duplicate = any(
            len(tokens & existing) / max(1, len(tokens | existing)) >= 0.48
            for existing in title_tokens
        )
        if is_duplicate or source_counts.get(source_key, 0) >= 4:
            continue
        stories.append(candidate)
        title_tokens.append(tokens)
        source_counts[source_key] = source_counts.get(source_key, 0) + 1
        if len(stories) == 48:
            break
    center_location = min(
        localities,
        key=lambda item: abs(item["_sampleLatitude"] - latitude) + abs(item["_sampleLongitude"] - longitude),
        default={"city": "Current location"},
    )
    payload = {
        "location": center_location,
        "stories": stories,
        "coverageRadiusMiles": 250,
        "localitiesQueried": len(unique_localities),
        "cachedAt": time.time(),
    }
    with NEWS_CACHE_LOCK:
        NEWS_CACHE[cache_key] = {"created": time.time(), "payload": payload}
    return payload


class FutureGlassHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path != "/api/news":
            return super().do_GET()

        try:
            query = urllib.parse.parse_qs(parsed.query)
            latitude = float(query["lat"][0])
            longitude = float(query["lon"][0])
            preferences = [value for value in query.get("preferences", [""])[0].split(",") if value]
            if not preferences or any(preference not in PREFERENCE_TERMS for preference in preferences):
                raise ValueError("Invalid preference")
            payload = get_local_news(latitude, longitude, preferences)
            body = json.dumps(payload).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "public, max-age=600")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except (KeyError, ValueError):
            self.send_error(400, "Valid lat and lon parameters are required")
        except Exception as error:
            self.log_error("News refresh failed: %s", error)
            self.send_error(502, "Unable to retrieve sourced local news")


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8765"))
    print(f"FutureGlass running at http://localhost:{port}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", port), FutureGlassHandler).serve_forever()
