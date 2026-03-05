'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import MetricCard from './MetricCard';
import TimeSeriesChart from './TimeSeriesChart';

interface TelemetryRow {
  node_id: string;
  bms_id: string;
  ts_utc: string;
  soc: number;
  pack_voltage: number;
  pack_current: number;
  temp_high: number;
  temp_low: number;
  ccl: number;
  dcl: number;
  fault_active: boolean;
  faults_cleared_min: number;
  highest_cell_v: number;
  lowest_cell_v: number;
}

type TimeRange = '1h' | '6h' | '24h';

type DataPoint = { time: string; value: number };
type TempPoint = { time: string; high: number; low: number };

export default function Dashboard() {
  const [nodes, setNodes] = useState<TelemetryRow[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [timeRange, setTimeRange] = useState<TimeRange>('1h');
  const [socData, setSocData] = useState<DataPoint[]>([]);
  const [voltageData, setVoltageData] = useState<DataPoint[]>([]);
  const [tempData, setTempData] = useState<TempPoint[]>([]);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);
  const initialized = useRef(false);

  const fetchLatest = useCallback(async () => {
    try {
      const res = await fetch('/api/latest');
      const data: TelemetryRow | TelemetryRow[] = await res.json();
      const rows = Array.isArray(data) ? data : [data];
      setNodes(rows);
      if (!initialized.current && rows.length > 0) {
        setSelectedId(rows[0].node_id);
        initialized.current = true;
      }
      setLastUpdated(new Date());
    } catch {
      // silent refresh failure — keeps stale data on screen
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchCharts = useCallback(async (nodeId: string, range: TimeRange) => {
    const base = `/api/metrics?node_id=${encodeURIComponent(nodeId)}&range=${range}`;
    try {
      const [socRes, voltRes, tempRes] = await Promise.all([
        fetch(`${base}&metric=soc`),
        fetch(`${base}&metric=pack_voltage`),
        fetch(`${base}&metric=temperature`),
      ]);
      setSocData(await socRes.json());
      setVoltageData(await voltRes.json());
      setTempData(await tempRes.json());
    } catch {
      // keep stale chart data
    }
  }, []);

  useEffect(() => {
    fetchLatest();
    const id = setInterval(fetchLatest, 5000);
    return () => clearInterval(id);
  }, [fetchLatest]);

  useEffect(() => {
    if (selectedId) fetchCharts(selectedId, timeRange);
  }, [selectedId, timeRange, fetchCharts]);

  const row = nodes.find((n) => n.node_id === selectedId);
  const fmt = (v: number | undefined, decimals = 1) =>
    v !== undefined ? v.toFixed(decimals) : '—';

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen text-slate-400 text-sm">
        Connecting to UEI Cloud...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-cyan-400 tracking-tight">
          UEI Cloud Dashboard
        </h1>
          {lastUpdated && (
            <p className="text-slate-500 text-xs mt-1">
              Updated {lastUpdated.toLocaleTimeString()}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <a
            href="/chatbot"
            className="px-3 py-1.5 rounded-lg text-sm font-medium bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-cyan-400 transition-colors"
          >
            Ask AI
          </a>
          <span className="text-slate-400 text-sm">Node</span>
          <select
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            className="bg-slate-800 border border-slate-600 text-slate-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-cyan-500"
          >
            {nodes.map((n) => (
              <option key={n.node_id} value={n.node_id}>{n.node_id}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Fault Banner */}
      {row?.fault_active && (
        <div className="mb-6 bg-red-950 border border-red-600 rounded-xl p-4 flex items-center gap-3">
          <span className="text-red-400 font-bold text-lg">!</span>
          <div>
            <p className="text-red-300 font-semibold">Fault Active — {row.bms_id}</p>
            <p className="text-red-400 text-sm">Last cleared {fmt(row.faults_cleared_min)} min ago</p>
          </div>
        </div>
      )}

      {/* Metric Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
        <MetricCard
          label="State of Charge"
          value={fmt(row?.soc)}
          unit="%"
          showBar
          barValue={row?.soc}
          highlight={
            row?.soc === undefined ? 'normal'
            : row.soc >= 30 ? 'normal'
            : row.soc >= 15 ? 'warning'
            : 'danger'
          }
        />
        <MetricCard label="Pack Voltage" value={fmt(row?.pack_voltage)} unit="V" />
        <MetricCard label="Pack Current" value={fmt(row?.pack_current)} unit="A" />
        <MetricCard
          label="Temp High"
          value={fmt(row?.temp_high)}
          unit="C"
          highlight={row?.temp_high !== undefined && row.temp_high > 45 ? 'danger' : 'normal'}
        />
        <MetricCard label="Temp Low" value={fmt(row?.temp_low)} unit="C" />
        <MetricCard label="Highest Cell" value={fmt(row?.highest_cell_v, 3)} unit="V" />
        <MetricCard label="Lowest Cell" value={fmt(row?.lowest_cell_v, 3)} unit="V" />
        <MetricCard label="CCL" value={fmt(row?.ccl)} unit="A" />
        <MetricCard label="DCL" value={fmt(row?.dcl)} unit="A" />
        <MetricCard
          label="Fault Status"
          value={row?.fault_active ? 'ACTIVE' : 'Clear'}
          highlight={row?.fault_active ? 'danger' : 'success'}
        />
      </div>

      {/* Time Range Controls */}
      <div className="flex items-center gap-3 mb-4">
        <span className="text-slate-400 text-sm">Range</span>
        {(['1h', '6h', '24h'] as TimeRange[]).map((r) => (
          <button
            key={r}
            onClick={() => setTimeRange(r)}
            className={`px-3 py-1 rounded-lg text-sm font-medium transition-colors ${
              timeRange === r
                ? 'bg-cyan-500 text-slate-950'
                : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
            }`}
          >
            {r}
          </button>
        ))}
      </div>

      {/* Charts */}
      <div className="flex flex-col gap-4">
        <TimeSeriesChart
          data={socData}
          title="State of Charge"
          lines={[{ key: 'value', label: 'SOC', color: '#06b6d4', unit: '%' }]}
        />
        <TimeSeriesChart
          data={voltageData}
          title="Pack Voltage"
          lines={[{ key: 'value', label: 'Voltage', color: '#a78bfa', unit: 'V' }]}
        />
        <TimeSeriesChart
          data={tempData}
          title="Temperature"
          lines={[
            { key: 'high', label: 'Temp High', color: '#f97316', unit: 'C' },
            { key: 'low', label: 'Temp Low', color: '#60a5fa', unit: 'C' },
          ]}
        />
      </div>

      {/* Footer */}
      <div className="mt-8 text-center text-slate-700 text-xs">
        UEI Cloud Platform &middot; {row?.bms_id ?? '—'}
      </div>
    </div>
  );
}
