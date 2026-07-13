function metricAt(snapshot, path) {
  if (path === "database.connectionUtilizationPercent") {
    const connections = Number(snapshot?.database?.connections);
    const maximum = Number(snapshot?.database?.maxConnections);
    return Number.isFinite(connections) && Number.isFinite(maximum) && maximum > 0
      ? connections / maximum * 100
      : null;
  }
  if (path === "push.receiptFailureRatePercent") {
    const delivered = Number(snapshot?.push?.deliveredRecent);
    const failed = Number(snapshot?.push?.permanentFailureRecent);
    const total = delivered + failed;
    return Number.isFinite(total) && total > 0 ? failed / total * 100 : 0;
  }
  let current = snapshot;
  for (const part of path.split(".")) current = current && typeof current === "object" ? current[part] : undefined;
  const value = Number(current);
  return Number.isFinite(value) ? value : null;
}

function breached(value, comparison, threshold) {
  return comparison === "below" ? value < threshold : value > threshold;
}

export function evaluateOperationalAlerts(configuration, snapshot, source = "operations-health") {
  const results = [];
  for (const alert of configuration.alerts ?? []) {
    if (alert.source !== source) continue;
    const value = metricAt(snapshot, alert.metric);
    let state = "unknown";
    if (value !== null) {
      if (breached(value, alert.comparison, alert.critical)) state = "critical";
      else if (breached(value, alert.comparison, alert.warning)) state = "warning";
      else state = "healthy";
    }
    results.push({
      alertId: alert.id,
      metric: alert.metric,
      owner: alert.owner,
      runbook: alert.runbook,
      state,
      value
    });
  }
  return results;
}

export function operationalAlertSummary(results) {
  return {
    critical: results.filter((result) => result.state === "critical").length,
    healthy: results.filter((result) => result.state === "healthy").length,
    unknown: results.filter((result) => result.state === "unknown").length,
    warning: results.filter((result) => result.state === "warning").length
  };
}
