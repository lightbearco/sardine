import { useEffect, useMemo, useRef, useState } from "react";
import {
	ColorType,
	createChart,
	type CandlestickData,
	type HistogramData,
	type IChartApi,
	type ISeriesApi,
	type Time,
} from "lightweight-charts";
import { MaximizeButton } from "#/components/dashboard/MaximizeButton";
import { useMarketData } from "#/hooks/useMarketData";
import { useSessionDashboard } from "#/hooks/useSessionDashboard";
import { useSymbolSelection } from "#/hooks/useSymbolSelection";

const DEFAULT_UP_COLOR = "#3fb950";
const DEFAULT_DOWN_COLOR = "#f85149";

const TERMINAL_CHART_COLORS = {
	background: "#0d1117",
	text: "#8b949e",
	border: "#30363d",
	grid: "#1c2128",
	green: DEFAULT_UP_COLOR,
	red: DEFAULT_DOWN_COLOR,
} as const;

interface CandlestickChartProps {
	colors?: {
		up?: string;
		down?: string;
	};
	showVolume?: boolean;
}

function toCandleData(
	bars: ReturnType<typeof useMarketData>["bars"],
	convertTick: (tick: number) => Time,
): CandlestickData<Time>[] {
	return bars.map((bar) => ({
		time: convertTick(bar.tick),
		open: Number(bar.open),
		high: Number(bar.high),
		low: Number(bar.low),
		close: Number(bar.close),
	}));
}

function toVolumeData(
	bars: ReturnType<typeof useMarketData>["bars"],
	colors: { green: string; red: string },
	convertTick: (tick: number) => Time,
): HistogramData<Time>[] {
	return bars.map((bar) => {
		const open = Number(bar.open);
		const close = Number(bar.close);
		return {
			time: convertTick(bar.tick),
			value: bar.volume,
			color: close >= open ? colors.green : colors.red,
		};
	});
}

export function CandlestickChart({
	colors: colorOverrides,
	showVolume: showVolumeProp = true,
}: CandlestickChartProps = {}) {
	const { symbol } = useSymbolSelection();
	const { session, simState } = useSessionDashboard();
	const { bars, isConnected } = useMarketData(symbol);
	const [showVolume, setShowVolume] = useState(showVolumeProp);
	const candleContainerRef = useRef<HTMLDivElement | null>(null);
	const volumeContainerRef = useRef<HTMLDivElement | null>(null);
	const candleChartRef = useRef<IChartApi | null>(null);
	const volumeChartRef = useRef<IChartApi | null>(null);
	const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
	const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
	const syncingRef = useRef(false);
	const colors = useMemo(
		() => ({
			...TERMINAL_CHART_COLORS,
			green: colorOverrides?.up ?? TERMINAL_CHART_COLORS.green,
			red: colorOverrides?.down ?? TERMINAL_CHART_COLORS.red,
		}),
		[colorOverrides],
	);
	const colorsRef = useRef(colors);
	colorsRef.current = colors;
	const prevSymbolRef = useRef(symbol);
	const prevLengthRef = useRef(0);

	const reference = useMemo(() => {
		if (!simState) return null;

		const simulatedTime =
			simState.simulatedTime instanceof Date
				? simState.simulatedTime
				: new Date(simState.simulatedTime);
		const timeMs = simulatedTime.getTime();
		if (!Number.isFinite(timeMs)) return null;

		return { tick: simState.simTick, timeMs };
	}, [simState]);

	const tickDurationMs = useMemo(
		() => session.simulatedTickDuration * 1000,
		[session.simulatedTickDuration],
	);

	const convertTickToTime = useMemo(() => {
		if (!reference) return (tick: number) => tick as Time;

		return (tick: number) => {
			const offsetTicks = reference.tick - tick;
			const timestampMs = reference.timeMs - offsetTicks * tickDurationMs;
			return Number.isFinite(timestampMs)
				? ((timestampMs / 1000) as Time)
				: (tick as Time);
		};
	}, [reference, tickDurationMs]);

	const prevConvertTickToTimeRef = useRef(convertTickToTime);

	const initialShowVolumeRef = useRef(showVolumeProp);

	useEffect(() => {
		if (!candleContainerRef.current || !volumeContainerRef.current) return;

		const candleChart = createChart(candleContainerRef.current, {
			autoSize: true,
			layout: {
				background: {
					type: ColorType.Solid,
					color: TERMINAL_CHART_COLORS.background,
				},
				textColor: TERMINAL_CHART_COLORS.text,
			},
			grid: {
				vertLines: { color: TERMINAL_CHART_COLORS.grid },
				horzLines: { color: TERMINAL_CHART_COLORS.grid },
			},
			rightPriceScale: {
				borderColor: TERMINAL_CHART_COLORS.border,
			},
			timeScale: {
				borderColor: TERMINAL_CHART_COLORS.border,
				timeVisible: true,
				secondsVisible: false,
				visible: !initialShowVolumeRef.current,
			},
			crosshair: {
				vertLine: { color: TERMINAL_CHART_COLORS.border },
				horzLine: { color: TERMINAL_CHART_COLORS.border },
			},
		});

		const candleSeries = candleChart.addCandlestickSeries({
			upColor: colorsRef.current.green,
			downColor: colorsRef.current.red,
			borderVisible: false,
			wickUpColor: colorsRef.current.green,
			wickDownColor: colorsRef.current.red,
		});

		const volumeChart = createChart(volumeContainerRef.current, {
			autoSize: true,
			layout: {
				background: {
					type: ColorType.Solid,
					color: TERMINAL_CHART_COLORS.background,
				},
				textColor: TERMINAL_CHART_COLORS.text,
			},
			grid: {
				vertLines: { color: TERMINAL_CHART_COLORS.grid },
				horzLines: { color: TERMINAL_CHART_COLORS.grid },
			},
			rightPriceScale: {
				borderColor: TERMINAL_CHART_COLORS.border,
			},
			timeScale: {
				borderColor: TERMINAL_CHART_COLORS.border,
				timeVisible: true,
				secondsVisible: false,
			},
			crosshair: {
				vertLine: { color: TERMINAL_CHART_COLORS.border },
				horzLine: { color: TERMINAL_CHART_COLORS.border },
			},
		});

		const volumeSeries = volumeChart.addHistogramSeries({
			priceFormat: { type: "volume" },
		});

		candleChart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
			if (syncingRef.current || !range) return;
			syncingRef.current = true;
			volumeChart.timeScale().setVisibleLogicalRange(range);
			syncingRef.current = false;
		});

		volumeChart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
			if (syncingRef.current || !range) return;
			syncingRef.current = true;
			candleChart.timeScale().setVisibleLogicalRange(range);
			syncingRef.current = false;
		});

		candleChartRef.current = candleChart;
		volumeChartRef.current = volumeChart;
		candleSeriesRef.current = candleSeries;
		volumeSeriesRef.current = volumeSeries;

		return () => {
			candleChart.remove();
			volumeChart.remove();
			candleChartRef.current = null;
			volumeChartRef.current = null;
			candleSeriesRef.current = null;
			volumeSeriesRef.current = null;
		};
	}, []);

	useEffect(() => {
		const candleChart = candleChartRef.current;
		if (!candleChart) return;
		candleChart.applyOptions({
			timeScale: {
				visible: !showVolume,
			},
		});
	}, [showVolume]);

	useEffect(() => {
		const candleSeries = candleSeriesRef.current;
		if (!candleSeries) return;
		candleSeries.applyOptions({
			upColor: colors.green,
			downColor: colors.red,
			wickUpColor: colors.green,
			wickDownColor: colors.red,
		});
	}, [colors]);

	useEffect(() => {
		const candleSeries = candleSeriesRef.current;
		const volumeSeries = volumeSeriesRef.current;
		const candleChart = candleChartRef.current;
		const volumeChart = volumeChartRef.current;
		if (!candleSeries || !candleChart) return;

		const timeConverterChanged =
			prevConvertTickToTimeRef.current !== convertTickToTime;
		prevConvertTickToTimeRef.current = convertTickToTime;

		if (symbol !== prevSymbolRef.current) {
			candleSeries.setData(toCandleData(bars, convertTickToTime));
			volumeSeries?.setData(
				toVolumeData(bars, colorsRef.current, convertTickToTime),
			);
			prevSymbolRef.current = symbol;
			prevLengthRef.current = bars.length;
			candleChart.timeScale().fitContent();
			volumeChart?.timeScale().fitContent();
			return;
		}

		if (bars.length === 0) {
			candleSeries.setData([]);
			volumeSeries?.setData([]);
			prevLengthRef.current = 0;
			return;
		}

		if (
			timeConverterChanged ||
			prevLengthRef.current === 0 ||
			bars.length < prevLengthRef.current
		) {
			candleSeries.setData(toCandleData(bars, convertTickToTime));
			volumeSeries?.setData(
				toVolumeData(bars, colorsRef.current, convertTickToTime),
			);
			if (timeConverterChanged || prevLengthRef.current === 0) {
				candleChart.timeScale().fitContent();
				volumeChart?.timeScale().fitContent();
			}
		} else {
			const lastBar = bars[bars.length - 1];
			if (lastBar) {
				candleSeries.update({
					time: convertTickToTime(lastBar.tick),
					open: Number(lastBar.open),
					high: Number(lastBar.high),
					low: Number(lastBar.low),
					close: Number(lastBar.close),
				});
				volumeSeries?.update({
					time: convertTickToTime(lastBar.tick),
					value: lastBar.volume,
					color:
						Number(lastBar.close) >= Number(lastBar.open)
							? colorsRef.current.green
							: colorsRef.current.red,
				});
			}
		}

		prevLengthRef.current = bars.length;
	}, [bars, symbol, convertTickToTime]);

	const last = bars[bars.length - 1];
	const open = last ? Number(last.open) : null;
	const close = last ? Number(last.close) : null;
	const changePct =
		open && close && open > 0 ? ((close - open) / open) * 100 : null;
	const changePositive = changePct !== null && changePct >= 0;

	return (
		<section className="flex h-full min-h-0 flex-col rounded-xl border border-(--terminal-border) bg-(--terminal-surface)">
			<div className="flex items-center gap-3 border-b border-(--terminal-border) px-3 py-2 shrink-0">
				<span className="text-xs font-semibold text-(--terminal-text)">
					{symbol}
				</span>
				{last && (
					<>
						<span className="font-mono text-sm font-bold text-(--terminal-text)">
							{close?.toFixed(2)}
						</span>
						{changePct !== null && (
							<span
								className="text-xs font-semibold tabular-nums"
								style={{
									color: changePositive
										? "var(--terminal-green)"
										: "var(--terminal-red)",
								}}
							>
								{changePositive ? "+" : ""}
								{changePct.toFixed(2)}%
							</span>
						)}
						<div className="flex items-center gap-3 text-[10px] text-(--terminal-text-muted) ml-1">
							<span>
								O{" "}
								<span className="text-(--terminal-text)">
									{Number(last.open).toFixed(2)}
								</span>
							</span>
							<span>
								H{" "}
								<span style={{ color: "var(--terminal-green)" }}>
									{Number(last.high).toFixed(2)}
								</span>
							</span>
							<span>
								L{" "}
								<span style={{ color: "var(--terminal-red)" }}>
									{Number(last.low).toFixed(2)}
								</span>
							</span>
							<span>
								V{" "}
								<span className="text-(--terminal-text)">
									{last.volume.toLocaleString()}
								</span>
							</span>
						</div>
					</>
				)}
				<span className="ml-auto text-[10px] text-(--terminal-text-muted)">
					{isConnected ? "Live" : "Waiting"}
				</span>
				<button
					type="button"
					onClick={() => setShowVolume((v) => !v)}
					className="rounded px-1.5 py-0.5 text-[10px] font-medium border border-(--terminal-border) transition-colors"
					style={{
						color: showVolume
							? "var(--terminal-green)"
							: "var(--terminal-text-muted)",
						borderColor: showVolume ? "var(--terminal-green)" : undefined,
					}}
				>
					Vol {showVolume ? "On" : "Off"}
				</button>
				<MaximizeButton panelId="chart" />
			</div>
			<div className="flex min-h-0 flex-1 flex-col">
				<div
					ref={candleContainerRef}
					className="min-h-0"
					style={{ flex: showVolume ? "1 1 0%" : "1 1 100%" }}
				/>
				<div
					className="shrink-0"
					style={{
						background: TERMINAL_CHART_COLORS.border,
						height: showVolume ? 1 : 0,
					}}
				/>
				<div
					ref={volumeContainerRef}
					className="min-h-0 overflow-hidden"
					style={{ flex: showVolume ? "0 0 25%" : "0 0 0px" }}
				/>
			</div>
		</section>
	);
}
