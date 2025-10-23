// @ts-nocheck
let chartPromise = null;

const configureChartDefaults = (Chart) => {
  if (!Chart || !Chart.defaults) {
    return Chart;
  }
  Chart.defaults.font.family = "'Inter', system-ui, sans-serif";
  Chart.defaults.color = '#0f172a';
  Chart.defaults.borderColor = 'rgba(148, 163, 184, 0.35)';
  return Chart;
};

export const loadChart = async () => {
  if (!chartPromise) {
    chartPromise = import('chart.js/auto')
      .then((module) => {
        const Chart = module?.default ?? module;
        return configureChartDefaults(Chart);
      })
      .catch((error) => {
        chartPromise = null;
        throw error;
      });
  }
  return chartPromise;
};
