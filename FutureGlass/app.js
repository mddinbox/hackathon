const slider = document.querySelector("#radiusSlider");
const radiusValue = document.querySelector("#radiusValue");
const radiusRing = document.querySelector(".radius-ring");
const radiusLabel = radiusRing.querySelector("span");
const presets = [...document.querySelectorAll("[data-radius]")];
const cards = [...document.querySelectorAll(".news-card")];
const mapStatusCount = document.querySelector(".map-status span:first-child");
const toast = document.querySelector("#toast");
const refreshStatus = document.querySelector("#refreshStatus");
const satelliteMapElement = document.querySelector("#satelliteMap");
const geoOverlay = document.querySelector("#geoOverlay");
const geoWeatherOverlay = document.querySelector("#geoWeatherOverlay");
const mapFrame = document.querySelector(".map-frame");
const dragSurface = document.querySelector("#dragSurface");
const bearingReadout = document.querySelector("#bearingReadout");
const layerControls = document.querySelector(".layer-controls");
const briefing = document.querySelector(".briefing");
const newsPreference = document.querySelector("#newsPreference");
const allCategoriesInput = newsPreference.querySelector('input[value="all"]');
const categoryInputs = [...newsPreference.querySelectorAll('input:not([value="all"])')];
const preferenceSummary = document.querySelector("#preferenceSummary");
const REFRESH_INTERVAL = 15 * 60 * 1000;
const MAX_NEWS_RADIUS_MILES = 250;
let refreshDeadline = Date.now() + REFRESH_INTERVAL;
let mapCenter = { latitude: 47.6062, longitude: -122.3321 };
let locationAccuracyMeters = 0;
let locationWatchId = null;
let mapBearing = 0;
let dragStartX = 0;
let dragStartBearing = 0;
let satelliteMap;
let launchCompleted = false;
const launchStartedAt = performance.now();
let lastWeatherLocation = null;
let weatherRefreshTimer = null;
const storyDialog = document.querySelector("#storyDialog");
let lastNewsLocation = null;
let newsCache = [];
const savedNewsPreference = localStorage.getItem("futureglass-news-preference");
if (savedNewsPreference) {
  try {
    const savedCategories = JSON.parse(savedNewsPreference);
    categoryInputs.forEach(input => {
      input.checked = Array.isArray(savedCategories) && savedCategories.includes(input.value);
    });
  } catch {
    categoryInputs.forEach(input => {
      input.checked = savedNewsPreference === "all" || input.value === savedNewsPreference;
    });
  }
}
let draggedCard = null;
let cardDragOffsetX = 0;
let cardDragOffsetY = 0;

mapFrame.appendChild(layerControls);
document.querySelector(".hero").appendChild(briefing);
document.querySelector(".lower-dashboard").remove();

document.querySelectorAll(".map-pin:not(.home-pin)").forEach(pin => geoOverlay.appendChild(pin));
geoOverlay.appendChild(document.querySelector(".radius-ring"));
geoOverlay.appendChild(document.querySelector(".home-pin"));
document.querySelectorAll(".weather-layer").forEach(layer => geoWeatherOverlay.appendChild(layer));
document.querySelector(".wind-layer").dataset.windLabel = "WIND FROM SW · 8 MPH · FLOWING NE";
document.querySelector(".smoke-layer").dataset.smokeLabel = "HIGH INTENSITY · CASCADES";
geoWeatherOverlay.style.setProperty("--wind-angle", "-45deg");

function initializeSatelliteMap() {
  if (satelliteMap) return;
  satelliteMap = L.map(satelliteMapElement, {
    attributionControl: true,
    zoomControl: false,
    dragging: false,
    scrollWheelZoom: false,
    doubleClickZoom: false,
    boxZoom: false,
    keyboard: false,
    tap: false,
    zoomSnap: .1,
    zoomDelta: .1,
    zoomAnimation: true,
    fadeAnimation: true,
    markerZoomAnimation: false
  }).setView([mapCenter.latitude, mapCenter.longitude], bingZoomForRadius(Number(slider.value)));
  satelliteMap.on("zoomend moveend", () => {
    updateAccurateRadiusRing();
    projectStoryPins();
  });

  const imageryLayer = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    {
      maxZoom: 19,
      keepBuffer: 8,
      updateWhenIdle: false,
      attribution: "Imagery © Esri, Maxar, Earthstar Geographics"
    }
  );
  imageryLayer.once("load", completeLaunch);
  imageryLayer.addTo(satelliteMap);
}

function startExperience() {
  if (satelliteMap) return;
  initializeSatelliteMap();
  updateRadius(slider.value);
  updateSunPosition();
  refreshWeather();
  refreshNews();
}

function completeLaunch() {
  if (launchCompleted) return;
  launchCompleted = true;
  const remainingMinimum = Math.max(0, 1850 - (performance.now() - launchStartedAt));
  window.setTimeout(() => {
    document.querySelector("#boot").classList.add("done");
    document.body.classList.add("loaded");
    requestAnimationFrame(() => {
      projectStoryPins();
      drawAnchorLines();
    });
  }, remainingMinimum);
}

function setMapBearing(value) {
  mapBearing = ((value % 360) + 360) % 360;
  updateMapTransform();
  bearingReadout.textContent = `${String(Math.round(mapBearing)).padStart(3, "0")}°`;
  requestAnimationFrame(() => {
    layoutNewsCards();
    drawAnchorLines();
  });
}

function updateMapTransform() {
  const radians = mapBearing * Math.PI / 180;
  const cosine = Math.abs(Math.cos(radians));
  const sine = Math.abs(Math.sin(radians));
  const aspectRatio = mapFrame.clientWidth / Math.max(1, mapFrame.clientHeight);
  const coverScale = Math.max(
    cosine + sine / aspectRatio,
    cosine + sine * aspectRatio
  );
  mapFrame.style.setProperty("--map-bearing", `${mapBearing}deg`);
  mapFrame.style.setProperty("--map-counter-bearing", `${-mapBearing}deg`);
  mapFrame.style.setProperty("--map-cover-scale", coverScale.toFixed(4));
  mapFrame.style.setProperty("--map-counter-scale", (1 / coverScale).toFixed(4));
}

dragSurface.addEventListener("pointerdown", event => {
  dragStartX = event.clientX;
  dragStartBearing = mapBearing;
  dragSurface.setPointerCapture(event.pointerId);
  mapFrame.classList.add("dragging");
});

dragSurface.addEventListener("pointermove", event => {
  if (!dragSurface.hasPointerCapture(event.pointerId)) return;
  setMapBearing(dragStartBearing + (event.clientX - dragStartX) * .35);
});

function endMapDrag(event) {
  if (dragSurface.hasPointerCapture(event.pointerId)) dragSurface.releasePointerCapture(event.pointerId);
  mapFrame.classList.remove("dragging");
}

dragSurface.addEventListener("pointerup", endMapDrag);
dragSurface.addEventListener("pointercancel", endMapDrag);

cards.forEach(card => {
  card.addEventListener("pointerdown", event => {
    if (event.target.closest("button")) return;
    const cardRect = card.getBoundingClientRect();
    const frameRect = mapFrame.getBoundingClientRect();
    draggedCard = card;
    cardDragOffsetX = event.clientX - cardRect.left;
    cardDragOffsetY = event.clientY - cardRect.top;
    card.dataset.manualPosition = "true";
    card.style.left = `${cardRect.left - frameRect.left}px`;
    card.style.top = `${cardRect.top - frameRect.top}px`;
    card.classList.add("dragging");
    card.setPointerCapture(event.pointerId);
    event.preventDefault();
  });

  card.addEventListener("pointermove", event => {
    if (draggedCard !== card || !card.hasPointerCapture(event.pointerId)) return;
    const frameRect = mapFrame.getBoundingClientRect();
    const maxX = frameRect.width - card.offsetWidth - 8;
    const maxY = frameRect.height - card.offsetHeight - 8;
    const x = Math.max(8, Math.min(maxX, event.clientX - frameRect.left - cardDragOffsetX));
    const y = Math.max(8, Math.min(maxY, event.clientY - frameRect.top - cardDragOffsetY));
    card.style.left = `${x}px`;
    card.style.top = `${y}px`;
    drawAnchorLines();
  });

  function endCardDrag(event) {
    if (draggedCard !== card) return;
    if (card.hasPointerCapture(event.pointerId)) card.releasePointerCapture(event.pointerId);
    card.classList.remove("dragging");
    draggedCard = null;
    drawAnchorLines();
  }

  card.addEventListener("pointerup", endCardDrag);
  card.addEventListener("pointercancel", endCardDrag);
});

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("show"), 2600);
}

function updateRangeFill(value) {
  const percent = ((value - Number(slider.min)) / (Number(slider.max) - Number(slider.min))) * 100;
  slider.style.background = `linear-gradient(90deg, var(--cyan) ${percent}%, #29424a ${percent}%)`;
}

function updateRadius(value, announce = false, recenterMap = true) {
  const radius = Number(value);
  slider.value = radius;
  radiusValue.textContent = radius;
  radiusLabel.textContent = `${radius} MI HORIZON`;
  updateRangeFill(radius);
  if (newsCache.length > 0) populateNewsCards(radius);

  presets.forEach(button => button.classList.toggle("active", Number(button.dataset.radius) === radius));
  cards.forEach(card => {
    const distance = distanceInMiles(
      mapCenter.latitude,
      mapCenter.longitude,
      Number(card.dataset.lat),
      Number(card.dataset.lon)
    );
    card.dataset.distance = String(distance);
    card.classList.toggle("hidden", distance > radius || card.dataset.feedVisible === "false");
    card.querySelector("footer span").textContent = `${Math.max(1, Math.round(distance))} MI AWAY · ${card.dataset.location}`;
  });
  const visibleStories = cards.filter(card => !card.classList.contains("hidden")).length;
  const cachedStoriesInRange = newsCache.filter(story =>
    distanceInMiles(
      mapCenter.latitude,
      mapCenter.longitude,
      Number(story.latitude),
      Number(story.longitude)
    ) <= radius
  ).length;
  mapStatusCount.innerHTML = `<i></i> ${cachedStoriesInRange || visibleStories} STORIES IN RANGE · ${visibleStories} SHOWN`;
  if (recenterMap) updateSatelliteMap();
  updateMapTransform();
  updateAccurateRadiusRing();
  projectStoryPins();

  if (announce) showToast(`News horizon updated to ${radius} miles`);
}

function distanceInMiles(latitudeA, longitudeA, latitudeB, longitudeB) {
  const toRadians = value => value * Math.PI / 180;
  const earthRadiusMiles = 3958.8;
  const latitudeDelta = toRadians(latitudeB - latitudeA);
  const longitudeDelta = toRadians(longitudeB - longitudeA);
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(toRadians(latitudeA)) * Math.cos(toRadians(latitudeB))
    * Math.sin(longitudeDelta / 2) ** 2;
  return earthRadiusMiles * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function bingZoomForRadius(radius) {
  if (radius <= 25) return 11;
  if (radius <= 50) return 10;
  if (radius <= 100) return 9;
  if (radius <= 175) return 8;
  return 7;
}

function updateSatelliteMap() {
  if (!satelliteMap) return;
  const { latitude, longitude } = mapCenter;
  satelliteMap.invalidateSize({ pan: false });
  const radiusMeters = MAX_NEWS_RADIUS_MILES * 1609.344;
  const north = destinationPoint(latitude, longitude, radiusMeters, 0);
  const east = destinationPoint(latitude, longitude, radiusMeters, 90);
  const south = destinationPoint(latitude, longitude, radiusMeters, 180);
  const west = destinationPoint(latitude, longitude, radiusMeters, 270);
  const bounds = L.latLngBounds(
    [south.latitude, west.longitude],
    [north.latitude, east.longitude]
  );
  const padding = Math.max(72, Math.min(mapFrame.clientWidth, mapFrame.clientHeight) * .14);
  const zoom = satelliteMap.getBoundsZoom(bounds, false, L.point(padding * 2, padding * 2));
  const animate = launchCompleted && Math.abs(satelliteMap.getZoom() - zoom) <= 2;
  satelliteMap.setView([latitude, longitude], zoom, { animate });
  updateSunPosition();
}

function updateAccurateRadiusRing() {
  if (!satelliteMap) return;
  const radiusMeters = Number(slider.value) * 1609.344;
  const { latitude, longitude } = mapCenter;
  const north = satelliteMap.latLngToContainerPoint(destinationLatLng(latitude, longitude, radiusMeters, 0));
  const east = satelliteMap.latLngToContainerPoint(destinationLatLng(latitude, longitude, radiusMeters, 90));
  const south = satelliteMap.latLngToContainerPoint(destinationLatLng(latitude, longitude, radiusMeters, 180));
  const west = satelliteMap.latLngToContainerPoint(destinationLatLng(latitude, longitude, radiusMeters, 270));
  const center = satelliteMap.latLngToContainerPoint([latitude, longitude]);
  radiusRing.style.setProperty("--radius-width", `${east.x - west.x}px`);
  radiusRing.style.setProperty("--radius-height", `${south.y - north.y}px`);
  radiusRing.style.setProperty("--radius-x", `${center.x}px`);
  radiusRing.style.setProperty("--radius-y", `${center.y}px`);
  radiusLabel.textContent = `${slider.value} MI HORIZON`;
  const accuracyEdge = satelliteMap.latLngToContainerPoint(
    destinationLatLng(latitude, longitude, locationAccuracyMeters, 90)
  );
  const accuracyPixels = Math.abs(accuracyEdge.x - center.x);
  document.querySelector(".home-pin").style.setProperty("--accuracy-diameter", `${Math.max(12, accuracyPixels * 2)}px`);
}

function destinationPoint(latitude, longitude, distanceMeters, bearingDegrees) {
  const earthRadiusMeters = 6371008.8;
  const angularDistance = distanceMeters / earthRadiusMeters;
  const bearing = bearingDegrees * Math.PI / 180;
  const latitudeRadians = latitude * Math.PI / 180;
  const longitudeRadians = longitude * Math.PI / 180;
  const destinationLatitude = Math.asin(
    Math.sin(latitudeRadians) * Math.cos(angularDistance)
    + Math.cos(latitudeRadians) * Math.sin(angularDistance) * Math.cos(bearing)
  );
  const destinationLongitude = longitudeRadians + Math.atan2(
    Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(latitudeRadians),
    Math.cos(angularDistance) - Math.sin(latitudeRadians) * Math.sin(destinationLatitude)
  );
  return {
    latitude: destinationLatitude * 180 / Math.PI,
    longitude: ((destinationLongitude * 180 / Math.PI + 540) % 360) - 180
  };
}

function destinationLatLng(latitude, longitude, distanceMeters, bearingDegrees) {
  const point = destinationPoint(latitude, longitude, distanceMeters, bearingDegrees);
  return [point.latitude, point.longitude];
}

function updateSunPosition() {
  const now = new Date();
  const startOfYear = new Date(now.getFullYear(), 0, 0);
  const dayOfYear = Math.floor((now - startOfYear) / 86400000);
  const fractionalYear = 2 * Math.PI / 365 * (dayOfYear - 1 + (now.getHours() - 12) / 24);
  const equationOfTime = 229.18 * (
    .000075 + .001868 * Math.cos(fractionalYear) - .032077 * Math.sin(fractionalYear)
    - .014615 * Math.cos(2 * fractionalYear) - .040849 * Math.sin(2 * fractionalYear)
  );
  const declination = .006918 - .399912 * Math.cos(fractionalYear)
    + .070257 * Math.sin(fractionalYear) - .006758 * Math.cos(2 * fractionalYear)
    + .000907 * Math.sin(2 * fractionalYear) - .002697 * Math.cos(3 * fractionalYear)
    + .00148 * Math.sin(3 * fractionalYear);
  const timezoneHours = -now.getTimezoneOffset() / 60;
  const solarMinutes = now.getHours() * 60 + now.getMinutes() + equationOfTime
    + 4 * mapCenter.longitude - 60 * timezoneHours;
  const hourAngle = (solarMinutes / 4 - 180) * Math.PI / 180;
  const latitude = mapCenter.latitude * Math.PI / 180;
  const cosZenith = Math.sin(latitude) * Math.sin(declination)
    + Math.cos(latitude) * Math.cos(declination) * Math.cos(hourAngle);
  const elevation = 90 - Math.acos(Math.max(-1, Math.min(1, cosZenith))) * 180 / Math.PI;
  const azimuth = (Math.atan2(
    Math.sin(hourAngle),
    Math.cos(hourAngle) * Math.sin(latitude) - Math.tan(declination) * Math.cos(latitude)
  ) * 180 / Math.PI + 180 + 360) % 360;

  const sunLayer = document.querySelector(".sun-layer");
  const daylight = Math.max(0, Math.min(1, (elevation + 6) / 12));
  const twilight = 1 - Math.abs(daylight * 2 - 1);
  const moonAzimuth = (azimuth + 180) % 360;
  const displayAzimuth = azimuth * daylight + moonAzimuth * (1 - daylight);
  const radians = (displayAzimuth - 90) * Math.PI / 180;
  const radius = 34;
  const x = 50 + Math.cos(radians) * radius;
  const y = 50 + Math.sin(radians) * radius;
  sunLayer.style.setProperty("--sun-x", `${x}%`);
  sunLayer.style.setProperty("--sun-y", `${y}%`);
  sunLayer.style.setProperty("--sun-label-x", `${Math.min(82, Math.max(8, x + 4))}%`);
  sunLayer.style.setProperty("--sun-label-y", `${Math.min(82, Math.max(8, y - 9))}%`);
  sunLayer.style.setProperty("--daylight", daylight.toFixed(3));
  sunLayer.style.setProperty("--sun-core-opacity", daylight.toFixed(3));
  sunLayer.style.setProperty("--moon-opacity", (1 - daylight).toFixed(3));
  sunLayer.style.setProperty("--twilight-opacity", twilight.toFixed(3));
  if (elevation > 6) {
    sunLayer.dataset.solarLabel = `SUN · ${Math.round(azimuth)}° · ${Math.round(elevation)}° HIGH`;
  } else if (elevation > -6) {
    sunLayer.dataset.solarLabel = `TWILIGHT · SUN ${Math.round(azimuth)}°`;
  } else {
    sunLayer.dataset.solarLabel = `MOONLIGHT · ${Math.round(moonAzimuth)}°`;
  }
}

function projectStoryPins() {
  const frame = document.querySelector(".map-frame");
  if (!satelliteMap) return;
  const homePin = document.querySelector(".home-pin");
  homePin.style.left = `${frame.clientWidth / 2}px`;
  homePin.style.top = `${frame.clientHeight / 2}px`;

  cards.forEach(card => {
    const pin = document.querySelector(`.map-pin[data-pin="${card.dataset.pin}"]`);
    const point = satelliteMap.latLngToContainerPoint([Number(card.dataset.lat), Number(card.dataset.lon)]);
    const x = point.x;
    const y = point.y;
    const outside = x < 0 || x > frame.clientWidth || y < 0 || y > frame.clientHeight;
    pin.style.left = `${x}px`;
    pin.style.top = `${y}px`;
    pin.classList.toggle("outside", outside || card.classList.contains("hidden"));
    pin.title = `${card.dataset.location} · ${Math.max(1, Math.round(Number(card.dataset.distance)))} miles away`;
  });
  projectWeatherAreas();
  requestAnimationFrame(() => {
    layoutNewsCards();
    drawAnchorLines();
  });
}

function layoutNewsCards() {
  if (window.innerWidth <= 760) {
    cards.forEach(card => {
      if (card.dataset.manualPosition === "true") return;
      card.style.removeProperty("left");
      card.style.removeProperty("top");
    });
    return;
  }
  const frameRect = mapFrame.getBoundingClientRect();
  const ringRect = radiusRing.getBoundingClientRect();
  const margin = 22;
  const gap = 22;
  const centerX = ringRect.left + ringRect.width / 2 - frameRect.left;
  const centerY = ringRect.top + ringRect.height / 2 - frameRect.top;
  const ringRadiusX = ringRect.width / 2;
  const ringRadiusY = ringRect.height / 2;
  const visibleCards = cards.filter(card => !card.classList.contains("hidden"));
  const occupied = visibleCards
    .filter(card => card.dataset.manualPosition === "true")
    .map(card => {
      const rect = card.getBoundingClientRect();
      const x = rect.left - frameRect.left;
      const y = rect.top - frameRect.top;
      return { x, y, right: x + rect.width, bottom: y + rect.height };
    });
  [layerControls, document.querySelector(".map-status")].forEach(element => {
    const rect = element.getBoundingClientRect();
    occupied.push({
      x: rect.left - frameRect.left - 10,
      y: rect.top - frameRect.top - 10,
      right: rect.right - frameRect.left + 10,
      bottom: rect.bottom - frameRect.top + 10
    });
  });
  const anchorSegments = [];

  const automaticCards = visibleCards
    .filter(card => card.dataset.manualPosition !== "true")
    .map(card => {
      const pin = document.querySelector(`.map-pin[data-pin="${card.dataset.pin}"]`);
      if (!pin || pin.classList.contains("outside")) return null;
      const pinRect = pin.getBoundingClientRect();
      const pinX = pinRect.left + pinRect.width / 2 - frameRect.left;
      const pinY = pinRect.top + pinRect.height / 2 - frameRect.top;
      return { card, pin, pinX, pinY, angle: Math.atan2(pinY - centerY, pinX - centerX) };
    })
    .filter(Boolean)
    .sort((left, right) => left.angle - right.angle);

  automaticCards.forEach(({ card, pinX, pinY, angle }) => {
    const width = card.offsetWidth;
    const height = card.offsetHeight;
    const angularOffsets = [0, .18, -.18, .36, -.36, .55, -.55, .78, -.78, 1.05, -1.05];
    const outwardFactors = [1, .88, .74, .58, .42, .2, 0];
    const candidates = [];

    angularOffsets.forEach(offset => {
      const candidateAngle = angle + offset;
      const cosine = Math.cos(candidateAngle);
      const sine = Math.sin(candidateAngle);
      const ellipseBoundary = 1 / Math.sqrt(
        cosine ** 2 / Math.max(1, ringRadiusX ** 2)
        + sine ** 2 / Math.max(1, ringRadiusY ** 2)
      );
      const cardExtent = Math.abs(cosine) * width / 2 + Math.abs(sine) * height / 2;
      const horizontalLimit = cosine > 0
        ? (frameRect.width - margin - centerX) / Math.max(.001, cosine)
        : (margin - centerX) / Math.min(-.001, cosine);
      const verticalLimit = sine > 0
        ? (frameRect.height - 52 - centerY) / Math.max(.001, sine)
        : (margin - centerY) / Math.min(-.001, sine);
      const viewportBoundary = Math.min(horizontalLimit, verticalLimit);
      const minimumDistance = ellipseBoundary + cardExtent + gap;
      const maximumDistance = Math.max(minimumDistance, viewportBoundary - cardExtent);

      outwardFactors.forEach(outwardFactor => {
        const distance = minimumDistance + (maximumDistance - minimumDistance) * outwardFactor;
        candidates.push({
          x: centerX + cosine * distance - width / 2,
          y: centerY + sine * distance - height / 2,
          angularOffset: Math.abs(offset),
          inwardFactor: 1 - outwardFactor
        });
      });
    });
    const addPerimeterCandidate = (x, y) => {
      const candidateCenterX = x + width / 2;
      const candidateCenterY = y + height / 2;
      const candidateAngle = Math.atan2(candidateCenterY - centerY, candidateCenterX - centerX);
      const angleDifference = Math.abs(Math.atan2(
        Math.sin(candidateAngle - angle),
        Math.cos(candidateAngle - angle)
      ));
      candidates.push({
        x,
        y,
        angularOffset: angleDifference,
        inwardFactor: 0
      });
    };
    const horizontalStep = Math.max(90, width * .72);
    const verticalStep = Math.max(80, height * .72);
    for (let x = margin; x <= frameRect.width - width - margin; x += horizontalStep) {
      addPerimeterCandidate(x, margin);
      addPerimeterCandidate(x, frameRect.height - height - 52);
    }
    for (let y = margin; y <= frameRect.height - height - 52; y += verticalStep) {
      addPerimeterCandidate(margin, y);
      addPerimeterCandidate(frameRect.width - width - margin, y);
    }

    const options = candidates.map(candidate => {
      const x = Math.min(frameRect.width - width - margin, Math.max(margin, candidate.x));
      const y = Math.min(frameRect.height - height - 52, Math.max(margin, candidate.y));
      const rect = { x, y, right: x + width, bottom: y + height };
      const overlapArea = occupied.reduce((total, other) => {
        const overlapWidth = Math.max(0, Math.min(rect.right, other.right) - Math.max(rect.x, other.x));
        const overlapHeight = Math.max(0, Math.min(rect.bottom, other.bottom) - Math.max(rect.y, other.y));
        return total + overlapWidth * overlapHeight;
      }, 0);
      const nearestX = Math.max(x, Math.min(pinX, rect.right));
      const nearestY = Math.max(y, Math.min(pinY, rect.bottom));
      const segment = { x1: pinX, y1: pinY, x2: nearestX, y2: nearestY };
      const crossings = anchorSegments.reduce(
        (total, other) => total + (segmentsCross(segment, other) ? 1 : 0),
        0
      );
      const normalizedCardX = ((x + width / 2) - centerX) / Math.max(1, ringRadiusX);
      const normalizedCardY = ((y + height / 2) - centerY) / Math.max(1, ringRadiusY);
      const centerIntrusion = Math.max(0, 1.12 - Math.hypot(normalizedCardX, normalizedCardY));
      const edgeClamp = Math.hypot(x - candidate.x, y - candidate.y);
      return {
        rect,
        segment,
        score: overlapArea * 10000
          + crossings * 100000000
          + centerIntrusion * 100000
          + candidate.angularOffset * 800
          + candidate.inwardFactor * 1200
          + edgeClamp * 5
          + Math.hypot(nearestX - pinX, nearestY - pinY) * .15
      };
    }).sort((left, right) => left.score - right.score);

    const selected = options[0].rect;
    card.style.left = `${selected.x}px`;
    card.style.top = `${selected.y}px`;
    occupied.push(selected);
    anchorSegments.push(options[0].segment);
  });
}

function segmentsCross(left, right) {
  function orientation(ax, ay, bx, by, cx, cy) {
    return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  }

  const first = orientation(left.x1, left.y1, left.x2, left.y2, right.x1, right.y1);
  const second = orientation(left.x1, left.y1, left.x2, left.y2, right.x2, right.y2);
  const third = orientation(right.x1, right.y1, right.x2, right.y2, left.x1, left.y1);
  const fourth = orientation(right.x1, right.y1, right.x2, right.y2, left.x2, left.y2);
  return first * second < 0 && third * fourth < 0;
}

function projectWeatherAreas() {
  if (!satelliteMap) return;
  const smokeLayer = document.querySelector(".smoke-layer");
  let strongestX = 50;
  let strongestY = 30;

  smokeLayer.querySelectorAll("i").forEach((plume, index) => {
    const point = satelliteMap.latLngToContainerPoint([Number(plume.dataset.lat), Number(plume.dataset.lon)]);
    const x = point.x;
    const y = point.y;
    plume.style.setProperty("--smoke-x", `${x}px`);
    plume.style.setProperty("--smoke-y", `${y}px`);
    plume.style.opacity = x < -180 || x > mapFrame.clientWidth + 180 || y < -110 || y > mapFrame.clientHeight + 110 ? "0" : "1";
    if (index === 2) {
      strongestX = x / mapFrame.clientWidth * 100;
      strongestY = y / mapFrame.clientHeight * 100;
    }
  });

  smokeLayer.style.setProperty("--smoke-label-x", `${Math.min(78, Math.max(8, strongestX + 3))}%`);
  smokeLayer.style.setProperty("--smoke-label-y", `${Math.min(80, Math.max(8, strongestY - 10))}%`);
}

slider.addEventListener("input", event => updateRadius(event.target.value, false, false));
slider.addEventListener("change", event => updateRadius(event.target.value, true));
presets.forEach(button => button.addEventListener("click", () => updateRadius(button.dataset.radius, true)));

document.querySelectorAll(".layer-button").forEach(button => {
  button.addEventListener("click", () => {
    const layer = button.dataset.layer;
    button.classList.toggle("active");
    const active = button.classList.contains("active");
    button.querySelector("b").textContent = active ? "ON" : "OFF";
    document.querySelector(`.weather-layer[data-layer="${layer}"]`).classList.toggle("active", active);
    showToast(`${button.querySelector("strong").textContent} overlay ${active ? "enabled" : "disabled"}`);
  });
});

document.querySelector("#soundButton").addEventListener("click", event => {
  event.currentTarget.classList.toggle("muted");
  showToast(event.currentTarget.classList.contains("muted") ? "Ambient audio muted" : "Ambient audio enabled");
});

function applyLocation(position) {
  const { latitude, longitude, accuracy } = position.coords;
  mapCenter = { latitude, longitude };
  locationAccuracyMeters = accuracy || 0;
  startExperience();
  document.querySelector("#locationName").textContent = `${latitude.toFixed(5)}°, ${longitude.toFixed(5)}°`;
  document.querySelector(".home-pin").title = `Current location · accuracy ±${Math.round(locationAccuracyMeters)} m`;
  updateSatelliteMap();
  updateAccurateRadiusRing();
  updateRadius(slider.value);
  scheduleWeatherRefresh();
}

function scheduleWeatherRefresh() {
  window.clearTimeout(weatherRefreshTimer);
  weatherRefreshTimer = window.setTimeout(() => {
    const movedMiles = lastWeatherLocation
      ? distanceInMiles(
        lastWeatherLocation.latitude,
        lastWeatherLocation.longitude,
        mapCenter.latitude,
        mapCenter.longitude
      )
      : Number.POSITIVE_INFINITY;
    if (movedMiles >= .5 || !lastWeatherLocation) refreshWeather();
    const newsMovedMiles = lastNewsLocation
      ? distanceInMiles(
        lastNewsLocation.latitude,
        lastNewsLocation.longitude,
        mapCenter.latitude,
        mapCenter.longitude
      )
      : Number.POSITIVE_INFINITY;
    if (newsMovedMiles >= 5 || !lastNewsLocation) refreshNews();
  }, 600);
}

function startLocationTracking(announce = false) {
  if (!navigator.geolocation) {
    showToast("Location services are not supported in this browser");
    return;
  }

  if (locationWatchId !== null) navigator.geolocation.clearWatch(locationWatchId);
  if (announce) showToast("Starting continuous high-accuracy location tracking…");
  locationWatchId = navigator.geolocation.watchPosition(
    position => {
      applyLocation(position);
      if (announce) {
        showToast(`Location locked · accuracy ±${Math.round(position.coords.accuracy)} m`);
        announce = false;
      }
    },
    error => {
      const message = error.code === error.PERMISSION_DENIED
        ? "Location permission is required for accurate map alignment"
        : "Waiting for an accurate location signal";
      showToast(message);
    },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
  );
}

document.querySelector("#locateButton").addEventListener("click", () => startLocationTracking(true));

document.querySelectorAll(".news-card footer button").forEach((button, index) => {
  button.addEventListener("click", () => openStory(button.closest(".news-card"), index));
});

function openStory(card, index) {
  const category = card.querySelector(".card-meta span").textContent;
  const title = card.querySelector("h2").textContent;
  const deck = card.querySelector("p")?.textContent || `Reported by ${card.dataset.source}.`;
  const time = card.querySelector("time").textContent;
  const distance = card.querySelector("footer span").textContent;
  document.querySelector("#storyCategory").textContent = category;
  document.querySelector("#storyLocation").textContent =
    `${card.dataset.location} · LOCALITY-LEVEL POSITION`;
  document.querySelector("#storyIndex").textContent = String(index + 1).padStart(2, "0");
  document.querySelector("#storyTitle").textContent = title;
  document.querySelector("#storyDeck").textContent = deck;
  document.querySelector("#storyPublisher").textContent = card.dataset.source || "SOURCE UNAVAILABLE";
  document.querySelector("#storyTime").textContent = time;
  document.querySelector("#storyDistance").textContent = distance;
  const storyBody = document.querySelector("#storyBody");
  storyBody.replaceChildren();
  const sourceNotice = document.createElement("p");
  sourceNotice.textContent =
    `This headline was published by ${card.dataset.source}. The source feed does not provide the full article text, so FutureGlass does not generate or infer additional claims. Open the sourced article below to read the publisher’s complete reporting.`;
  storyBody.appendChild(sourceNotice);
  const facts = [
    `Publisher: ${card.dataset.source}`,
    `Published: ${formatPublishedDate(card.dataset.published)}`,
    card.dataset.locationPrecision
  ];
  const factsList = document.querySelector("#storyFacts");
  factsList.replaceChildren(...facts.map(fact => {
    const item = document.createElement("li");
    item.textContent = fact;
    return item;
  }));
  document.querySelector("#storySourceLink").href = card.dataset.sourceUrl;
  document.querySelector("#storyMapLink").href =
    `https://www.bing.com/maps?cp=${card.dataset.lat}~${card.dataset.lon}&lvl=13`;
  storyDialog.showModal();
}

document.querySelector("#storyClose").addEventListener("click", () => storyDialog.close());
storyDialog.addEventListener("click", event => {
  if (event.target === storyDialog) storyDialog.close();
});

async function refreshWeather() {
  const { latitude, longitude } = mapCenter;
  const weatherUrl = new URL("https://api.open-meteo.com/v1/forecast");
  weatherUrl.search = new URLSearchParams({
    latitude,
    longitude,
    current: "temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,wind_direction_10m",
    temperature_unit: "fahrenheit",
    wind_speed_unit: "mph",
    timezone: "auto"
  });
  const airQualityUrl = new URL("https://air-quality-api.open-meteo.com/v1/air-quality");
  airQualityUrl.search = new URLSearchParams({
    latitude,
    longitude,
    current: "us_aqi",
    timezone: "auto"
  });

  try {
    const [weatherResponse, airQualityResponse] = await Promise.all([
      fetch(weatherUrl),
      fetch(airQualityUrl)
    ]);
    if (!weatherResponse.ok) throw new Error(`Weather service returned HTTP ${weatherResponse.status}`);
    if (!airQualityResponse.ok) throw new Error(`Air-quality service returned HTTP ${airQualityResponse.status}`);
    const [weather, airQuality] = await Promise.all([
      weatherResponse.json(),
      airQualityResponse.json()
    ]);
    const current = weather.current;
    const aqi = Math.round(airQuality.current.us_aqi);
    const windDirection = Math.round(current.wind_direction_10m);
    const windCompass = degreesToCompass(windDirection);
    document.querySelector(".temp").textContent = `${Math.round(current.temperature_2m)}°`;
    document.querySelector(".weather-main strong").textContent = weatherDescription(current.weather_code);
    document.querySelector(".weather-main span").textContent = `Feels like ${Math.round(current.apparent_temperature)}°`;
    document.querySelector(".weather-stats > div:nth-child(1) strong").innerHTML =
      `${windCompass} ${Math.round(current.wind_speed_10m)} <span>mph</span>`;
    document.querySelector(".weather-stats > div:nth-child(2) strong").innerHTML =
      `${Math.round(current.relative_humidity_2m)}<span>%</span>`;
    document.querySelector(".aqi-stat strong").innerHTML = `<i></i> ${aqi} <span>US AQI</span>`;
    document.querySelector(".wind-layer").dataset.windLabel =
      `WIND FROM ${windCompass} · ${Math.round(current.wind_speed_10m)} MPH`;
    geoWeatherOverlay.style.setProperty("--wind-angle", `${windDirection + 90}deg`);
    document.querySelector(".smoke-layer").dataset.smokeLabel =
      `${aqiLabel(aqi)} · US AQI ${aqi}`;
    lastWeatherLocation = { latitude, longitude };
  } catch (error) {
    console.error("Unable to refresh local weather", error);
    showToast("Live weather could not be refreshed");
  }
}

function degreesToCompass(degrees) {
  const directions = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return directions[Math.round(degrees / 45) % directions.length];
}

function weatherDescription(code) {
  const descriptions = {
    0: "Clear sky",
    1: "Mainly clear",
    2: "Partly cloudy",
    3: "Overcast",
    45: "Fog",
    48: "Freezing fog",
    51: "Light drizzle",
    53: "Drizzle",
    55: "Heavy drizzle",
    61: "Light rain",
    63: "Rain",
    65: "Heavy rain",
    71: "Light snow",
    73: "Snow",
    75: "Heavy snow",
    80: "Rain showers",
    81: "Rain showers",
    82: "Heavy showers",
    95: "Thunderstorm",
    96: "Thunderstorm with hail",
    99: "Severe thunderstorm"
  };
  return descriptions[code] || "Current conditions";
}

function aqiLabel(aqi) {
  if (aqi <= 50) return "GOOD AIR QUALITY";
  if (aqi <= 100) return "MODERATE AIR QUALITY";
  if (aqi <= 150) return "UNHEALTHY FOR SENSITIVE GROUPS";
  if (aqi <= 200) return "UNHEALTHY AIR QUALITY";
  if (aqi <= 300) return "VERY UNHEALTHY AIR";
  return "HAZARDOUS AIR QUALITY";
}

async function refreshNews() {
  const { latitude, longitude } = mapCenter;
  const selectedCategories = categoryInputs.filter(input => input.checked).map(input => input.value);
  if (selectedCategories.length === 0) {
    newsCache = [];
    cards.forEach(card => {
      card.dataset.feedVisible = "false";
      card.classList.add("hidden");
    });
    updateRadius(slider.value);
    return;
  }
  try {
    const response = await fetch(
      `/api/news?lat=${encodeURIComponent(latitude)}&lon=${encodeURIComponent(longitude)}&preferences=${encodeURIComponent(selectedCategories.join(","))}`
    );
    if (!response.ok) throw new Error(`News service returned HTTP ${response.status}`);
    const payload = await response.json();
    if (!Array.isArray(payload.stories) || payload.stories.length === 0) {
      throw new Error("News service returned no local stories");
    }

    newsCache = payload.stories;
    lastNewsLocation = { latitude, longitude };
    updateRadius(slider.value);
  } catch (error) {
    console.error("Unable to refresh sourced local news", error);
    showToast("Sourced local news could not be refreshed");
  }
}

function populateNewsCards(radius) {
  const eligibleStories = newsCache
    .map(story => ({
      ...story,
      distance: distanceInMiles(
        mapCenter.latitude,
        mapCenter.longitude,
        Number(story.latitude),
        Number(story.longitude)
      )
    }))
    .filter(story => story.distance <= radius)
    .sort((left, right) => left.distance - right.distance);
  const localityGroups = new Map();
  eligibleStories.forEach(story => {
    if (!localityGroups.has(story.location)) localityGroups.set(story.location, []);
    localityGroups.get(story.location).push(story);
  });
  localityGroups.forEach(group => {
    group.sort((left, right) => new Date(right.published) - new Date(left.published));
  });
  const groups = [...localityGroups.values()].sort((left, right) => left[0].distance - right[0].distance);
  const selectedStories = [];
  while (selectedStories.length < cards.length && groups.some(group => group.length > 0)) {
    groups.forEach(group => {
      if (group.length > 0 && selectedStories.length < cards.length) selectedStories.push(group.shift());
    });
  }

  cards.forEach((card, index) => {
    const story = selectedStories[index];
    if (!story) {
      card.dataset.feedVisible = "false";
      card.classList.add("hidden");
      return;
    }
    applyStoryToCard(card, story);
  });
}

function applyStoryToCard(card, story) {
  const cleanTitle = story.title.endsWith(` - ${story.source}`)
    ? story.title.slice(0, -(story.source.length + 3))
    : story.title;
  const priority = isPriorityHeadline(cleanTitle);
  const sourceLabel = card.querySelector(".card-meta span");
  sourceLabel.textContent = story.source;
  sourceLabel.classList.toggle("alert-tag", priority);
  card.classList.toggle("priority", priority);
  card.querySelector("h2").textContent = cleanTitle;
  const summary = card.querySelector("p");
  if (summary) summary.textContent = `Verified headline from ${story.source}. Open the sourced article for full reporting.`;
  card.querySelector("time").textContent = relativeTime(story.published);
  card.dataset.lat = story.latitude;
  card.dataset.lon = story.longitude;
  card.dataset.location = story.location;
  card.dataset.locationPrecision = story.locationPrecision;
  card.dataset.source = story.source;
  card.dataset.sourceUrl = story.url;
  card.dataset.publisherUrl = story.sourceUrl;
  card.dataset.published = story.published;
  card.dataset.feedVisible = "true";
  delete card.dataset.manualPosition;
  card.style.removeProperty("left");
  card.style.removeProperty("top");
  card.classList.remove("hidden");
}

function syncPreferenceMenu() {
  const selected = categoryInputs.filter(input => input.checked);
  allCategoriesInput.checked = selected.length === categoryInputs.length;
  allCategoriesInput.indeterminate = selected.length > 0 && selected.length < categoryInputs.length;
  if (selected.length === categoryInputs.length) {
    preferenceSummary.textContent = "All categories";
  } else if (selected.length === 0) {
    preferenceSummary.textContent = "No categories";
  } else if (selected.length === 1) {
    preferenceSummary.textContent = selected[0].nextElementSibling.textContent;
  } else {
    preferenceSummary.textContent = `${selected.length} categories`;
  }
}

newsPreference.addEventListener("change", event => {
  if (event.target === allCategoriesInput) {
    categoryInputs.forEach(input => {
      input.checked = allCategoriesInput.checked;
    });
  }
  syncPreferenceMenu();
  const selectedCategories = categoryInputs.filter(input => input.checked).map(input => input.value);
  localStorage.setItem("futureglass-news-preference", JSON.stringify(selectedCategories));
  lastNewsLocation = null;
  showToast(selectedCategories.length ? "News categories updated" : "All news categories cleared");
  refreshNews();
});
syncPreferenceMenu();

function isPriorityHeadline(title) {
  return /\b(alert|advisory|emergency|evacuat(?:e|ion)|warning|wildfire|earthquake|flood|tornado|outage|closure|shelter in place|missing person)\b/i.test(title);
}

function relativeTime(value) {
  const published = new Date(value);
  if (Number.isNaN(published.getTime())) return "TIME UNAVAILABLE";
  const minutes = Math.max(0, Math.round((Date.now() - published.getTime()) / 60000));
  if (minutes < 60) return `${minutes} MIN AGO`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} HR AGO`;
  return `${Math.round(hours / 24)} DAY AGO`;
}

function formatPublishedDate(value) {
  const published = new Date(value);
  if (Number.isNaN(published.getTime())) return "Unavailable";
  return published.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

async function refreshLocalData() {
  await Promise.all([refreshWeather(), refreshNews()]);
  refreshDeadline = Date.now() + REFRESH_INTERVAL;
  updateRadius(slider.value);
  showToast("Local news and weather refreshed");
}

function updateRefreshCountdown() {
  const remaining = Math.max(0, refreshDeadline - Date.now());
  const minutes = Math.floor(remaining / 60000);
  const seconds = Math.floor((remaining % 60000) / 1000);
  const updated = new Date(refreshDeadline - REFRESH_INTERVAL).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  refreshStatus.textContent = `UPDATED ${updated} · NEXT IN ${minutes}:${String(seconds).padStart(2, "0")}`;
  if (remaining === 0) refreshLocalData();
}

function drawAnchorLines() {
  const svg = document.querySelector("#anchorLines");
  const frameRect = document.querySelector(".map-frame").getBoundingClientRect();
  svg.innerHTML = "";

  cards.filter(card => !card.classList.contains("hidden")).forEach(card => {
    const pin = document.querySelector(`.map-pin[data-pin="${card.dataset.pin}"]`);
    if (!pin) return;
    const cardRect = card.getBoundingClientRect();
    const pinRect = pin.getBoundingClientRect();
    const endX = pinRect.left + pinRect.width / 2 - frameRect.left;
    const endY = pinRect.top + pinRect.height / 2 - frameRect.top;
    const cardLeft = cardRect.left - frameRect.left;
    const cardTop = cardRect.top - frameRect.top;
    const startX = Math.max(cardLeft, Math.min(endX, cardLeft + cardRect.width));
    const startY = Math.max(cardTop, Math.min(endY, cardTop + cardRect.height));
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", `M ${startX} ${startY} L ${endX} ${endY}`);
    if (card.classList.contains("priority")) path.classList.add("alert-line");
    svg.appendChild(path);
  });
}

let resizeTimer;
window.addEventListener("resize", () => {
  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => {
    updateSatelliteMap();
    updateAccurateRadiusRing();
    projectStoryPins();
  }, 180);
});
window.addEventListener("load", () => {
  window.setInterval(updateSunPosition, 60000);
  updateRefreshCountdown();
  window.setInterval(updateRefreshCountdown, 1000);
  startLocationTracking(true);
  window.setTimeout(startExperience, 1000);
  window.setTimeout(completeLaunch, 6000);
});
