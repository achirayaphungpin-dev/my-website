// ===== CONFIG =====
const GEOJSON_URLS = {
  NOV: "./data/thailand_pm_province_NOV.geojson",
  DEC: "./data/thailand_pm_province_DEC.geojson",
};

// ===== GISTDA MapServer =====
const GISTDA_PM_SERVER = "https://gistdaportal.gistda.or.th/data/rest/services/pm_check/hotspot_pmcheck/MapServer";
const HOTSPOT_LAYER_ID = 0;
const DENSITY_LAYER_ID = 1;

const COLORS = {
  c1: "#90dbe8",
  c2: "#b1f163",
  c3: "#ebed75",
  c4: "#f6aa59",
  c5: "#ee4c45",
};

function pickColor(pmRaw) {
  const pm = Number(String(pmRaw ?? "").replace(",", "."));
  if (isNaN(pm)) return "#888888";
  if (pm <= 15.0) return COLORS.c1;
  if (pm <= 25.0) return COLORS.c2;
  if (pm <= 37.5) return COLORS.c3;
  if (pm <= 75.0) return COLORS.c4;
  return COLORS.c5;
}

const BREAKS = [
  { color: COLORS.c1, label: "0.0 – 15.0" },
  { color: COLORS.c2, label: "15.1 – 25.0" },
  { color: COLORS.c3, label: "25.1 – 37.5" },
  { color: COLORS.c4, label: "37.6 – 75.0" },
  { color: COLORS.c5, label: "> 75.1" },
];

function getAQStatus(pm) {
  if (pm == null || isNaN(pm)) {
    return { label: "—", emoji: "❓", color: "#888", max: 75.0 };
  }
  if (pm <= 15.0) return { label: "ดีมาก", emoji: "😄", color: COLORS.c1, max: 75.0 };
  if (pm <= 25.0) return { label: "ดี", emoji: "🙂", color: COLORS.c2, max: 75.0 };
  if (pm <= 37.5) return { label: "ปานกลาง", emoji: "😐", color: COLORS.c3, max: 75.0 };
  if (pm <= 75.0) return { label: "เริ่มกระทบสุขภาพ", emoji: "😷", color: COLORS.c4, max: 75.0 };
  return { label: "มีผลกระทบต่อสุขภาพ", emoji: "🤢", color: COLORS.c5, max: 75.0 };
}

// ===== MAP =====
const map = L.map("map", { zoomControl: true }).setView([13.5, 101.0], 6);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, opacity: 0.75 }).addTo(map);

// ===== STATE =====
let geojsonData = null;
let mainLayer = null;
let currentField = null;
let currentMonth = "DEC";
let selectedFeature = null; // จังหวัดที่เลือก
let selectedLayer = null;
let monthFields = []; // list *_mean ของเดือนปัจจุบัน
let monthChart = null;

// ===== HELPERS =====
function normalizeProps(gj) {
  (gj.features || []).forEach((f) => {
    const p = f.properties || {};
    const np = {};
    for (const [k, v] of Object.entries(p)) {
      const nk = String(k).replace(/\s+/g, "");
      np[nk] = v;
    }
    f.properties = np;
  });
  return gj;
}

function getMeanFieldsFromGeojson(gj) {
  const set = new Set();
  (gj.features || []).slice(0, 80).forEach((f) => {
    Object.keys(f.properties || {}).forEach((k) => set.add(k));
  });
  return Array.from(set).filter((k) => k.endsWith("_mean")).sort();
}

function formatDateFromField(field) {
  const clean = String(field).replace(/\s+/g, "");
  const y = clean.slice(0, 4);
  const m = clean.slice(4, 6);
  const d = clean.slice(6, 8);
  return `${d}/${m}/${y}`;
}

function styleFeature(feature) {
  const pm = Number(String(feature.properties?.[currentField] ?? "").replace(",", "."));
  return {
    color: "rgba(255,255,255,0.95)",
    weight: 1.2,
    fillColor: pickColor(pm),
    fillOpacity: 0.85,
  };
}

function computeNationAverageByField(field) {
  if (!geojsonData || !field) return null;
  const vals = geojsonData.features
    .map((f) => Number(String(f.properties?.[field] ?? "").replace(",", ".")))
    .filter((v) => !isNaN(v));
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function computeNationAverage() {
  return computeNationAverageByField(currentField);
}

// ===== UI =====
function updateNationBadge() {
  const avg = computeNationAverage();
  const badge = document.getElementById("nationBadge");
  if (badge) badge.textContent = `ประเทศ: ${avg == null ? "—" : avg.toFixed(1)} µg/m³`;
}

function updateAQWidget(pmValue, titleText = null) {
  const vEl = document.getElementById("aqValue");
  const eEl = document.getElementById("aqEmoji");
  const lEl = document.getElementById("aqLabel");
  const gEl = document.getElementById("aqGauge");
  const pEl = document.getElementById("aqPointer");
  const titleEl = document.getElementById("aqTitle");

  const color = pickColor(pmValue);  // เลือกสีจาก pickColor()
  
  if (!vEl || !eEl || !lEl || !gEl || !pEl) return;
  if (titleEl && titleText) titleEl.textContent = titleText;

  const pm = Number(pmValue);
  if (pm == null || isNaN(pm)) {
    vEl.textContent = "—";
    eEl.textContent = "❓";
    lEl.textContent = "—";
    gEl.style.background = `conic-gradient(#666 0deg, rgba(255,255,255,0.08) 0deg)`;  // สีเทา
    pEl.style.left = `0%`;
    return;
  }

  const st = getAQStatus(pm);
  vEl.textContent = pm.toFixed(1);
  eEl.textContent = st.emoji;
  lEl.textContent = st.label;

  const max = st.max;
  const pct = Math.max(0, Math.min(1, pm / max));
  const deg = pct * 360;

  // แทนที่ `color` ที่ได้จาก pickColor ในกราฟวงกลม
  gEl.style.background = `conic-gradient(${color} ${deg}deg, rgba(255,255,255,0.08) ${deg}deg)`;
  pEl.style.left = `${Math.max(0, Math.min(100, (pm / max) * 100))}%`;
}



// ===== CHART =====
function buildMonthlySeriesNation(fields) {
  const labels = fields.map((f) => formatDateFromField(f));
  const values = fields.map((f) => {
    const avg = computeNationAverageByField(f);
    return avg == null ? null : Number(avg.toFixed(2));
  });
  return { labels, values };
}

function buildMonthlySeriesProvince(feature, fields) {
  const p = feature?.properties || {};
  const labels = fields.map((f) => formatDateFromField(f));
  const values = fields.map((f) => {
    const v = Number(String(p[f] ?? "").replace(",", "."));
    return isNaN(v) ? null : Number(v.toFixed(2));
  });
  const nameTH = p.P_NAME_T || "จังหวัด";
  return { labels, values, nameTH };
}

function renderMonthChart(series, labelText) {
  const canvas = document.getElementById("monthChart");
  if (!canvas) return;

  // กันพังถ้าลืมโหลด chart.js
  if (typeof Chart === "undefined") {
    console.warn("Chart.js ยังไม่ได้โหลด (Chart is undefined)");
    return;
  }

  const titleEl = document.getElementById("chartTitle");
  if (titleEl) titleEl.textContent = labelText || "กราฟรายวันทั้งเดือน";

  const data = {
    labels: series.labels,
    datasets: [
      {
        label: labelText,
        data: series.values,
        spanGaps: true,
        tension: 0.35, // เส้นโค้งนุ่มขึ้น
        pointRadius: 3,
        pointHoverRadius: 6,
        borderWidth: 2,
        borderColor: "#5db3ff", // ✅ สีเส้นหลัก
        backgroundColor: "rgba(93,179,255,0.15)", // ✅ สี fill ใต้เส้น
        fill: true, // ✅ เปิดพื้นที่ใต้กราฟ
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: { enabled: true },
    },
    scales: {
      x: {
        ticks: { color: "#eaf0ff" },
        grid: { color: "rgba(255,255,255,0.05)" }, // จางลง
      },
      y: {
        ticks: { color: "#eaf0ff" },
        grid: { color: "rgba(255,255,255,0.05)" },
      },
    },
  };

  if (monthChart) {
    monthChart.data = data;
    monthChart.options = options;
    monthChart.update();
  } else {
    monthChart = new Chart(canvas, { type: "line", data, options });
  }
}

function renderChartDefaultNation() {
  if (!monthFields.length) return;
  renderMonthChart(buildMonthlySeriesNation(monthFields), "กราฟรายวันทั้งเดือน: รายประเทศ");
}

// ===== DAY SELECT =====
function buildDaySelect(fields) {
  const sel = document.getElementById("daySelect");
  if (!sel) return;
  sel.innerHTML = "";
  fields.forEach((f) => {
    const opt = document.createElement("option");
    opt.value = f;
    opt.textContent = formatDateFromField(f);
    sel.appendChild(opt);
  });
  currentField = fields[0];
  sel.value = currentField;

  // เปลี่ยนวัน = อัปเดตสี/legend/badge + widget (ไม่แตะกราฟ)
  sel.onchange = (e) => {
    currentField = e.target.value;
    if (mainLayer) mainLayer.setStyle(styleFeature);
    updateNationBadge();
    if (selectedFeature) {
      const p = selectedFeature.properties || {};
      const pm = Number(String(p[currentField] ?? "").replace(",", "."));
      updateAQWidget(pm, "PM2.5 ค่าเฉลี่ยรายจังหวัด");
    } else {
      updateAQWidget(computeNationAverage(), "PM2.5 ค่าเฉลี่ยรายประเทศ");
    }
  };
}

// ===== FEATURE EVENTS =====
function onEachFeature(feature, layer) {
  layer.on("mouseover", () => layer.setStyle({ weight: 2.2 }));
  layer.on("mouseout", () => mainLayer && mainLayer.resetStyle(layer));
  layer.on("click", () => {
    const p = feature.properties || {};
    const nameTH = p.P_NAME_T || "-";
    const nameEN = p.P_NAME_E || "-";
    const pm = Number(String(p[currentField] ?? "").replace(",", "."));
    selectedFeature = feature;
    selectedLayer = layer;

    // ✅ วาดกราฟรายจังหวัดทั้งเดือน
    if (monthFields.length) {
      const sProv = buildMonthlySeriesProvince(selectedFeature, monthFields);
      renderMonthChart({ labels: sProv.labels, values: sProv.values }, `กราฟรายวันทั้งเดือน: ${sProv.nameTH}`);
    }

    updateAQWidget(pm, "PM2.5 ค่าเฉลี่ยรายจังหวัด");

    const html = `
      <div style="font-family:system-ui; min-width:180px;">
        <div style="font-weight:800;font-size:14px;margin-bottom:4px;">${nameTH}</div>
        <div style="opacity:.9;">${nameEN}</div>
      </div>
    `;
    L.popup({ closeButton: true, autoPan: true })
      .setLatLng(layer.getBounds().getCenter())
      .setContent(html)
      .openOn(map);
  });
}

// ===== LOAD MONTH =====
function loadMonth(monthKey) {
  currentMonth = monthKey;
  const url = GEOJSON_URLS[monthKey];
  if (!url) {
    alert("ไม่พบไฟล์ของเดือน: " + monthKey);
    return;
  }
  if (mainLayer) {
    map.removeLayer(mainLayer);
    mainLayer = null;
  }
  selectedFeature = null;
  selectedLayer = null;
  fetch(url)
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}`);
      return r.json();
    })
    .then((gj) => {
      geojsonData = normalizeProps(gj);
      const fields = getMeanFieldsFromGeojson(geojsonData);
      if (!fields.length) {
        alert("ไม่พบคอลัมน์ *_mean ใน GeoJSON ของเดือนนี้");
        return;
      }
      monthFields = fields; // ✅ สำคัญ: เก็บไว้ใช้กับกราฟจังหวัด
      buildDaySelect(fields);
      mainLayer = L.geoJSON(geojsonData, { style: styleFeature, onEachFeature }).addTo(map);
      map.fitBounds(mainLayer.getBounds());
      updateNationBadge();
      updateAQWidget(computeNationAverage(), "PM2.5 ค่าเฉลี่ยรายประเทศ");
      // ✅ default chart renderChartDefaultNation();
    })
    .catch((err) => {
      console.error(err);
      alert("โหลด GeoJSON ไม่สำเร็จ: " + url);
    });
}

// ===== HOTSPOT + DENSITY =====
let overlayCtl = null;
let hotspotGroup = null;

function setupHotspotDensityLayer() {
  hotspotGroup = L.layerGroup();
  const densityLayer = L.esri.dynamicMapLayer({
    url: GISTDA_PM_SERVER,
    layers: [DENSITY_LAYER_ID],
    opacity: 0.75,
    format: "png32",
  });

  const hotspotLayer = L.esri.featureLayer({
    url: `${GISTDA_PM_SERVER}/${HOTSPOT_LAYER_ID}`,
    pointToLayer: function (_geojson, latlng) {
      return L.circleMarker(latlng, {
        radius: 1.5,
        color: "#f93f3f",
        weight: 1,
        fillColor: "#ff9a9a",
        fillOpacity: 0.75,
      });
    },
  });

  hotspotGroup.addLayer(densityLayer);
  hotspotGroup.addLayer(hotspotLayer);

  const overlays = {
    "Hotspot + Density": hotspotGroup,
  };

  if (overlayCtl) map.removeControl(overlayCtl);
  overlayCtl = L.control.layers(null, overlays, { collapsed: false }).addTo(map);
}

// ===== INIT =====
(function init() {
  // month select
  const monthSel = document.getElementById("monthSelect");
  if (monthSel) {
    currentMonth = monthSel.value || "DEC";
    monthSel.onchange = (e) => loadMonth(e.target.value);
  }

  // reset chart button
  const btnReset = document.getElementById("btnResetChart");
  if (btnReset) {
    btnReset.onclick = () => {
      selectedFeature = null;
      selectedLayer = null;
      renderChartDefaultNation();
      updateAQWidget(computeNationAverage(), "PM2.5 ค่าเฉลี่ยรายประเทศ");
    };
  }

  setupHotspotDensityLayer();
  loadMonth(currentMonth);
})();










