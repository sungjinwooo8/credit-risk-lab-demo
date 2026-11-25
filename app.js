"use strict";
const data = window.study;
const el = id => document.getElementById(id);
const pct = n => (100 * n).toFixed(2) + "%";
const points = n => (100 * n).toFixed(2) + " pp";
const count = n => new Intl.NumberFormat("en").format(n);
function node(tag, value, className) {
  const item = document.createElement(tag);
  if (value !== undefined) item.textContent = value;
  if (className) item.className = className;
  return item;
}
function rail(width, color) {
  const track = node("div", undefined, "rail");
  track.setAttribute("aria-hidden", "true");
  const fill = node("div", undefined, color);
  fill.style.width = width + "%";
  track.append(fill);
  return track;
}
const tuned = data.models.find(row => row.model === "CatBoost" && row.policy === "Validation max F1");
el("total").textContent = count(data.metadata.rows);
el("test").textContent = count(data.metadata.test);
el("base-rate").textContent = pct(data.metadata.test_positive_rate);
data.profiles.forEach((profile, index) => {
  const option = node("option", profile.name);
  option.value = index;
  el("profile").append(option);
});
function prediction() {
  const profile = data.profiles[Number(el("profile").value)];
  const cutoff = Number(el("cutoff").value) / 100;
  el("risk").textContent = pct(profile.score);
  el("risk-bar").style.width = pct(profile.score);
  el("cutoff-value").textContent = pct(cutoff);
  const flagged = profile.score >= cutoff;
  el("decision").textContent = flagged ? "Flagged for review" : "Below cutoff";
  el("decision").classList.toggle("flag", flagged);
  el("profile-details").replaceChildren(...Object.entries(profile.inputs).flatMap(([key,value]) =>
    [node("dt", key), node("dd", typeof value === "number" ? count(value) : value)]));
  const max = Math.max(...profile.drivers.map(driver => Math.abs(driver.value)), 1e-9);
  el("drivers").replaceChildren(...profile.drivers.map(driver => {
    const row = node("div", undefined, "driver");
    const label = node("div", undefined, "label-row");
    const direction = driver.value > 0 ? "Raised risk" : driver.value < 0 ? "Lowered risk" : "No effect";
    const indicator = node("strong", direction, driver.value > 0 ? "raised" : "lowered");
    indicator.setAttribute("title", "SHAP contribution in log-odds: " + driver.value.toFixed(3));
    label.append(node("span", driver.label), indicator);
    row.append(label, rail(100 * Math.abs(driver.value) / max, driver.value > 0 ? "positive" : ""));
    return row;
  }));
}
function compare() {
  const policy = el("policy").value;
  el("models").replaceChildren(...data.models.filter(row => row.policy === policy ||
      (row.model === "Majority" && row.policy === "Fixed 0.50")).map(row => {
    const tr = node("tr", undefined, row.model === "CatBoost" ? "featured" : "");
    const title = node("th", row.model);
    title.scope = "row";
    const timing = data.timings.find(item => item.model === row.model && item.batch_rows === 1000);
    tr.append(title, ...[pct(row.accuracy), row.f1.toFixed(4), pct(row.recall),
      row.roc_auc.toFixed(3), timing.median_ms.toFixed(2) + " ms"].map(value => node("td", value)));
    return tr;
  }));
}
function fairness() {
  const attribute = el("attribute").value;
  const rows = data.groups.filter(row => row.model === "CatBoost" && row.attribute === attribute && row.n_repaid >= 100);
  const fixed = rows.filter(row => row.policy === "Fixed 0.50");
  const tunedRows = rows.filter(row => row.policy === "Validation max F1");
  el("groups").replaceChildren(...fixed.map(row => {
    const alternative = tunedRows.find(item => item.group === row.group);
    const group = node("div", undefined, "group");
    const title = node("div", undefined, "group-title");
    title.append(node("strong", row.group), node("span", count(row.n_repaid) + " applicants", "denominator"));
    const bars = node("div", undefined, "group-bars");
    bars.append(rail(row.approval_rate_repaid * 100, "fixed"), node("span", pct(row.approval_rate_repaid)),
      rail(alternative.approval_rate_repaid * 100), node("span", pct(alternative.approval_rate_repaid)));
    group.append(title, bars);
    return group;
  }));
  const spread = items => Math.max(...items.map(row => row.approval_rate_repaid)) -
    Math.min(...items.map(row => row.approval_rate_repaid));
  el("gap").textContent = "Largest gap between groups: " + points(spread(fixed)) + " at the fixed cutoff and " +
    points(spread(tunedRows)) + " at the F1-tuned cutoff.";
}
function reset() {
  el("cutoff").value = (100 * tuned.cutoff).toFixed(2);
  prediction();
}
el("profile").addEventListener("change", prediction);
el("cutoff").addEventListener("input", prediction);
el("reset").addEventListener("click", reset);
el("policy").addEventListener("change", compare);
el("attribute").addEventListener("change", fairness);
reset();
compare();
fairness();

function capacityRows() {
  return data.capacity.filter(row => row.capacity === Number(el("capacity-limit").value));
}
function reviewPlanner() {
  const rows = capacityRows();
  const [catboost, xgboost] = rows;
  const winner = catboost.caught >= xgboost.caught ? catboost : xgboost;
  const displayedCutoff = Number((catboost.cutoff * 100).toFixed(2)) / 100;
  const hasFlaggedExample = data.profiles.some(profile => profile.score >= displayedCutoff);
  el("capacity-example").textContent = hasFlaggedExample
    ? "Explain a flagged CatBoost example"
    : "Try the CatBoost cutoff on an example";
  const delta = Math.abs(catboost.caught - xgboost.caught);
  el("capacity-result").textContent = delta
    ? winner.model + " catches " + count(delta) + " more cases at the same workload"
    : "Both models catch the same number of cases";
  el("capacity-detail").textContent = "Each model reviews " + count(catboost.reviewed) +
    " of the " + count(data.metadata.test) + " held-out applications.";
  const perThousand = n => (n * 1000 / data.metadata.test).toFixed(1);
  el("capacity-models").replaceChildren(...rows.map(row => {
    const tr = node("tr", undefined, delta && row === winner ? "featured" : "");
    const title = node("th", row.model);
    title.scope = "row";
    tr.append(title, ...[perThousand(row.caught), perThousand(row.false_alarms),
      perThousand(row.missed), points(row.age_gap), points(row.gender_gap)].map(value => node("td", value)));
    return tr;
  }));
}
function explainQueueExample() {
  const catboost = capacityRows().find(row => row.model === "CatBoost");
  el("cutoff").value = (100 * catboost.cutoff).toFixed(2);
  const highest = data.profiles.reduce((best, profile, i) =>
    profile.score > data.profiles[best].score ? i : best, 0);
  el("profile").value = highest;
  prediction();
}
el("capacity-limit").addEventListener("change", reviewPlanner);
el("capacity-example").addEventListener("click", explainQueueExample);
reviewPlanner();

function historyComparison() {
  const destination = el("history-models");
  destination.replaceChildren(...data.application_only.map(before => {
    const after = data.models.find(row => row.model === before.model && row.policy === before.policy);
    const tr = node("tr", undefined, before.model === "CatBoost" ? "featured" : "");
    const title = node("th", before.model);
    title.scope = "row";
    const delta = after.f1 - before.f1;
    tr.append(title, node("td", before.f1.toFixed(4)), node("td", after.f1.toFixed(4)),
      node("td", (delta > 0 ? "+" : "") + delta.toFixed(4)));
    return tr;
  }));
}
historyComparison();
