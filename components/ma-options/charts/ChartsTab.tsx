"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  RotateCcw,
  BarChart3,
  TrendingUp,
  LineChart,
} from "lucide-react";

import ChartWidgetInstance from "./ChartWidgetInstance";
import PresetSelector from "./PresetSelector";
import AddWidgetButton from "./AddWidgetButton";
import {
  GRID_COLS,
  ROW_HEIGHT,
  GRID_MARGIN,
  LAYOUT_STORAGE_KEY,
  BUILT_IN_PRESETS,
  SINGLE_CHART_PRESET,
  generateWidgetId,
  defaultTimeframe,
  defaultLayoutItem,
} from "./defaultLayouts";
import type {
  ChartWidgetConfig,
  ChartPreset,
  OverlayToggles,
  WidgetType,
  LayoutMap,
} from "./types";
import { useUIPreferences } from "@/lib/ui-preferences";

// react-grid-layout CSS
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

// ---------------------------------------------------------------------------
// Dynamic import of react-grid-layout (CJS/ESM safe)
// ---------------------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let RGLResponsive: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const RGL = require("react-grid-layout");
  RGLResponsive = RGL.Responsive || RGL.default?.Responsive || RGL;
} catch {
  // Will be caught at render time
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getBreakpoint(width: number): string {
  if (width >= 1200) return "lg";
  if (width >= 996) return "md";
  return "sm";
}

/** One-time migration of old localStorage layout to server-side preset */
function migrateLocalStorage(): LayoutMap | null {
  try {
    const raw = localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && Object.keys(parsed).length > 0) {
        localStorage.removeItem(LAYOUT_STORAGE_KEY);
        return parsed;
      }
    }
  } catch {
    // corrupt localStorage — ignore
  }
  return null;
}

// ---------------------------------------------------------------------------
// ChartsTab
// ---------------------------------------------------------------------------

export default function ChartsTab() {
  const { prefs, loaded, updatePrefs } = useUIPreferences();
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;

  // Widget/layout state — initialized to Single Chart defaults
  const [widgets, setWidgets] = useState<ChartWidgetConfig[]>(
    SINGLE_CHART_PRESET.widgets
  );
  const [layouts, setLayouts] = useState<LayoutMap>(
    SINGLE_CHART_PRESET.gridLayouts
  );
  const [overlayToggles, setOverlayToggles] = useState<OverlayToggles>({
    showSignals: true,
    showTrades: true,
    showVolume: true,
  });
  const [currentPresetName, setCurrentPresetName] = useState("Single Chart");

  // Grid measurement
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  // Save management: skip saves during preset loading
  const readyToSave = useRef(false);
  const activateSaveNextRender = useRef(false);

  // --- Measure container width ---
  useEffect(() => {
    if (!containerRef.current) return;
    const measure = () => {
      if (containerRef.current) {
        setContainerWidth(containerRef.current.offsetWidth);
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // --- Load preset from prefs (runs once when prefs become available) ---
  useEffect(() => {
    if (!loaded) return;

    readyToSave.current = false;
    activateSaveNextRender.current = true;

    const maPrefs = prefs.maOptionsPrefs as Record<string, unknown>;
    const savedPresets = {
      ...((maPrefs?.chartPresets ?? {}) as Record<string, ChartPreset>),
    };

    // One-time localStorage migration
    const migratedLayouts = migrateLocalStorage();
    if (migratedLayouts) {
      const migrated: ChartPreset = {
        ...SINGLE_CHART_PRESET,
        gridLayouts: migratedLayouts,
      };
      savedPresets["Single Chart"] = migrated;
      updatePrefs({
        maOptionsPrefs: {
          chartPresets: savedPresets,
          lastChartPreset: "Single Chart",
        },
      });
    }

    // Determine which preset to load
    const urlPreset =
      typeof window !== "undefined"
        ? new URLSearchParams(window.location.search).get("preset")
        : null;
    const lastPreset = maPrefs?.lastChartPreset as string | undefined;
    const targetName = urlPreset ?? lastPreset ?? "Single Chart";

    let preset: ChartPreset =
      savedPresets[targetName] ??
      BUILT_IN_PRESETS[targetName] ??
      SINGLE_CHART_PRESET;

    // Validate widgets array
    if (!preset.widgets || preset.widgets.length === 0) {
      preset = SINGLE_CHART_PRESET;
    }

    setCurrentPresetName(preset.name || targetName);
    setWidgets(preset.widgets);
    setLayouts(preset.gridLayouts);
    setOverlayToggles(
      preset.overlayToggles ?? {
        showSignals: true,
        showTrades: true,
        showVolume: true,
      }
    );

    // Update URL to reflect current preset
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("preset", preset.name || targetName);
      window.history.replaceState({}, "", url.toString());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  // --- Activate saves one render after loading completes ---
  useEffect(() => {
    if (activateSaveNextRender.current) {
      activateSaveNextRender.current = false;
      readyToSave.current = true;
    }
  });

  // --- Auto-save on state changes ---
  // Only auto-saves to user-created presets. Built-in presets (Single Chart,
  // Quad View) are never overwritten — use "Save As" to create a named copy.
  useEffect(() => {
    if (!readyToSave.current) return;

    // Skip auto-save for built-in presets — user must "Save As" explicitly
    if (currentPresetName in BUILT_IN_PRESETS) {
      // Still persist lastChartPreset so we re-open the right tab
      updatePrefs({
        maOptionsPrefs: { lastChartPreset: currentPresetName },
      });
      return;
    }

    const chartPresets = {
      ...(
        ((prefsRef.current.maOptionsPrefs as Record<string, unknown>)
          ?.chartPresets ?? {}) as Record<string, ChartPreset>
      ),
    };

    const preset: ChartPreset = {
      name: currentPresetName,
      widgets,
      gridLayouts: layouts,
      overlayToggles,
    };

    updatePrefs({
      maOptionsPrefs: {
        chartPresets: { ...chartPresets, [currentPresetName]: preset },
        lastChartPreset: currentPresetName,
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [widgets, layouts, overlayToggles, currentPresetName]);

  // --- Widget config change handler ---
  const handleWidgetConfigChange = useCallback(
    (id: string, partial: Partial<ChartWidgetConfig>) => {
      setWidgets((prev) =>
        prev.map((w) => (w.id === id ? { ...w, ...partial } : w))
      );
    },
    []
  );

  // --- Widget remove handler (guarded: can't remove last widget) ---
  const handleWidgetRemove = useCallback((id: string) => {
    setWidgets((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((w) => w.id !== id);
    });
    setLayouts((prev) => {
      const next: LayoutMap = {};
      for (const [bp, items] of Object.entries(prev)) {
        next[bp] = items.filter((item) => item.i !== id);
      }
      return next;
    });
  }, []);

  // --- Add widget handler ---
  const handleAddWidget = useCallback((type: WidgetType) => {
    const id = generateWidgetId();
    const newWidget: ChartWidgetConfig = {
      id,
      type,
      ticker: "SPY",
      ...(type === "price-chart" ? { timeframe: defaultTimeframe() } : {}),
    };

    setWidgets((prev) => [...prev, newWidget]);
    setLayouts((prev) => {
      const next: LayoutMap = {};
      for (const [bp, items] of Object.entries(prev)) {
        const cols = GRID_COLS[bp] ?? 12;
        next[bp] = [...items, defaultLayoutItem(id, type, cols)];
      }
      // Ensure all breakpoints exist
      for (const bp of ["lg", "md", "sm"]) {
        if (!next[bp]) {
          const cols = GRID_COLS[bp] ?? 12;
          next[bp] = [defaultLayoutItem(id, type, cols)];
        }
      }
      return next;
    });
  }, []);

  // --- Layout change handler (from react-grid-layout drag/resize) ---
  const handleLayoutChange = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (_currentLayout: any[], allLayouts: any) => {
      if (allLayouts && typeof allLayouts === "object") {
        setLayouts(allLayouts);
      }
    },
    []
  );

  // --- Select preset handler ---
  const handleSelectPreset = useCallback(
    (name: string) => {
      readyToSave.current = false;
      activateSaveNextRender.current = true;

      const savedPresets = (
        ((prefsRef.current.maOptionsPrefs as Record<string, unknown>)
          ?.chartPresets ?? {}) as Record<string, ChartPreset>
      );
      let preset: ChartPreset =
        savedPresets[name] ?? BUILT_IN_PRESETS[name] ?? SINGLE_CHART_PRESET;

      if (!preset.widgets || preset.widgets.length === 0) {
        preset = SINGLE_CHART_PRESET;
      }

      setCurrentPresetName(name);
      setWidgets(preset.widgets);
      setLayouts(preset.gridLayouts);
      setOverlayToggles(
        preset.overlayToggles ?? {
          showSignals: true,
          showTrades: true,
          showVolume: true,
        }
      );

      // Update URL
      if (typeof window !== "undefined") {
        const url = new URL(window.location.href);
        url.searchParams.set("preset", name);
        window.history.replaceState({}, "", url.toString());
      }

      // Save lastChartPreset immediately
      updatePrefs({
        maOptionsPrefs: { lastChartPreset: name },
      });
    },
    [updatePrefs]
  );

  // --- Save As handler ---
  const handleSaveAs = useCallback(
    (name: string) => {
      readyToSave.current = false;
      activateSaveNextRender.current = true;

      const chartPresets = {
        ...(
          ((prefsRef.current.maOptionsPrefs as Record<string, unknown>)
            ?.chartPresets ?? {}) as Record<string, ChartPreset>
        ),
      };

      const preset: ChartPreset = {
        name,
        widgets,
        gridLayouts: layouts,
        overlayToggles,
      };

      chartPresets[name] = preset;
      setCurrentPresetName(name);

      updatePrefs({
        maOptionsPrefs: {
          chartPresets,
          lastChartPreset: name,
        },
      });

      // Update URL
      if (typeof window !== "undefined") {
        const url = new URL(window.location.href);
        url.searchParams.set("preset", name);
        window.history.replaceState({}, "", url.toString());
      }
    },
    [widgets, layouts, overlayToggles, updatePrefs]
  );

  // --- Delete preset handler ---
  const handleDeletePreset = useCallback(
    (name: string) => {
      const chartPresets = {
        ...(
          ((prefsRef.current.maOptionsPrefs as Record<string, unknown>)
            ?.chartPresets ?? {}) as Record<string, ChartPreset>
        ),
      };
      delete chartPresets[name];

      const isDeletingCurrent = name === currentPresetName;

      if (isDeletingCurrent) {
        readyToSave.current = false;
        activateSaveNextRender.current = true;

        setCurrentPresetName("Single Chart");
        setWidgets(SINGLE_CHART_PRESET.widgets);
        setLayouts(SINGLE_CHART_PRESET.gridLayouts);
        setOverlayToggles(SINGLE_CHART_PRESET.overlayToggles);
      }

      const updates: Record<string, unknown> = { chartPresets };
      if (isDeletingCurrent) {
        updates.lastChartPreset = "Single Chart";
      }
      updatePrefs({ maOptionsPrefs: updates });
    },
    [currentPresetName, updatePrefs]
  );

  // --- Overlay toggle handler ---
  const toggleOverlay = useCallback((key: keyof OverlayToggles) => {
    setOverlayToggles((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  // --- Reset layout to built-in template ---
  const handleResetLayout = useCallback(() => {
    const builtIn = BUILT_IN_PRESETS[currentPresetName];
    if (builtIn) {
      readyToSave.current = false;
      activateSaveNextRender.current = true;

      setWidgets(builtIn.widgets);
      setLayouts(builtIn.gridLayouts);
      setOverlayToggles(builtIn.overlayToggles);
    }
  }, [currentPresetName]);

  // --- Compute saved presets for the selector ---
  const savedPresets = (
    ((prefs.maOptionsPrefs as Record<string, unknown>)?.chartPresets ??
      {}) as Record<string, ChartPreset>
  );

  return (
    <div className="flex flex-col gap-2">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Preset selector */}
        <PresetSelector
          currentPreset={currentPresetName}
          savedPresets={savedPresets}
          onSelect={handleSelectPreset}
          onSaveAs={handleSaveAs}
          onDelete={handleDeletePreset}
        />

        {/* Add widget */}
        <AddWidgetButton onAdd={handleAddWidget} />

        {/* Overlay toggles */}
        <div className="flex items-center gap-1 ml-auto">
          <button
            onClick={() => toggleOverlay("showSignals")}
            className={`flex items-center gap-1 px-2 py-1 text-xs rounded border transition-colors ${
              overlayToggles.showSignals
                ? "border-blue-500/50 bg-blue-500/10 text-blue-400"
                : "border-gray-700 text-gray-500 hover:text-gray-400"
            }`}
            title="Toggle signal markers"
          >
            <LineChart className="h-3 w-3" />
            Signals
          </button>
          <button
            onClick={() => toggleOverlay("showTrades")}
            className={`flex items-center gap-1 px-2 py-1 text-xs rounded border transition-colors ${
              overlayToggles.showTrades
                ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-400"
                : "border-gray-700 text-gray-500 hover:text-gray-400"
            }`}
            title="Toggle trade markers"
          >
            <TrendingUp className="h-3 w-3" />
            Trades
          </button>
          <button
            onClick={() => toggleOverlay("showVolume")}
            className={`flex items-center gap-1 px-2 py-1 text-xs rounded border transition-colors ${
              overlayToggles.showVolume
                ? "border-purple-500/50 bg-purple-500/10 text-purple-400"
                : "border-gray-700 text-gray-500 hover:text-gray-400"
            }`}
            title="Toggle volume histogram"
          >
            <BarChart3 className="h-3 w-3" />
            Volume
          </button>

          <div className="w-px h-4 bg-gray-700 mx-1" />

          <button
            onClick={handleResetLayout}
            className="flex items-center gap-1 px-2 py-1 text-xs text-gray-500 hover:text-gray-400 rounded border border-gray-700 hover:border-gray-600 transition-colors"
            title="Reset to preset defaults"
          >
            <RotateCcw className="h-3 w-3" />
            Reset
          </button>
        </div>
      </div>

      {/* Grid layout */}
      <div ref={containerRef}>
        {containerWidth > 0 && RGLResponsive ? (
          <RGLResponsive
            className="layout"
            layouts={layouts}
            breakpoints={{ lg: 1200, md: 996, sm: 768 }}
            cols={GRID_COLS}
            rowHeight={ROW_HEIGHT}
            width={containerWidth}
            margin={GRID_MARGIN}
            draggableHandle=".drag-handle"
            onLayoutChange={handleLayoutChange}
            useCSSTransforms
            compactType="vertical"
          >
            {widgets.map((widget) => (
              <div key={widget.id} style={{ width: "100%", height: "100%" }}>
                <ChartWidgetInstance
                  config={widget}
                  overlayToggles={overlayToggles}
                  onConfigChange={handleWidgetConfigChange}
                  onRemove={
                    widgets.length > 1
                      ? () => handleWidgetRemove(widget.id)
                      : undefined
                  }
                />
              </div>
            ))}
          </RGLResponsive>
        ) : (
          <div className="text-sm text-gray-500 py-8 text-center">
            Loading chart grid...
          </div>
        )}
      </div>
    </div>
  );
}
