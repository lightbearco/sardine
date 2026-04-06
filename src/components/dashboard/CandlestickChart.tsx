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
	const containerRef = useRef<HTMLDivElement | null>(null);
	const chartRef = useRef<IChartApi | null>(null);
	const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
	const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
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
		if (!simState) {
			return null;
		}

		const simulatedTime =
			simState.simulatedTime instanceof Date
				? simState.simulatedTime
				: new Date(simState.simulatedTime);
		const timeMs = simulatedTime.getTime();
		if (!Number.isFinite(timeMs)) {
			return null;
		}

		return {
			tick: simState.simTick,
			timeMs,
		};
	}, [simState]);

	const tickDurationMs = useMemo(
		() => session.simulatedTickDuration * 1000,
		[session.simulatedTickDuration],
	);

	const convertTickToTime = useMemo(() => {
		if (!reference) {
			return (tick: number) => tick as Time;
		}

		return (tick: number) => {
			const offsetTicks = reference.tick - tick;
			const timestampMs = reference.timeMs - offsetTicks * tickDurationMs;
			return Number.isFinite(timestampMs)
				? ((timestampMs / 1000) as Time)
				: (tick as Time);
		};
	}, [reference, tickDurationMs]);

	const prevConvertTickToTimeRef = useRef(convertTickToTime);

	useEffect(() => {
		if (!containerRef.current) {
			return;
		}

		const chart = createChart(containerRef.current, {
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

		const candleSeries = chart.addCandlestickSeries({
			upColor: colorsRef.current.green,
			downColor: colorsRef.current.red,
			borderVisible: false,
			wickUpColor: colorsRef.current.green,
			wickDownColor: colorsRef.current.red,
		});

		let volumeSeries: ISeriesApi<"Histogram"> | null = null;
		if (showVolume) {
			volumeSeries = chart.addHistogramSeries({
				priceScaleId: "",
				priceFormat: { type: "volume" },
			});
			volumeSeries.priceScale().applyOptions({
				scaleMargins: {
					top: 0.8,
					bottom: 0,
				},
			});
		}

		chartRef.current = chart;
		candleSeriesRef.current = candleSeries;
		volumeSeriesRef.current = volumeSeries;

		const observer = new ResizeObserver((entries) => {
			const entry = entries[0];
			if (entry) {
				chart.resize(entry.contentRect.width, entry.contentRect.height);
			}
		});
		observer.observe(containerRef.current);

		return () => {
			observer.disconnect();
			chart.remove();
			chartRef.current = null;
			candleSeriesRef.current = null;
			volumeSeriesRef.current = null;
		};
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
		const chart = chartRef.current;
		if (!candleSeries || !chart) {
			return;
		}

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
			chart.timeScale().fitContent();
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
				chart.timeScale().fitContent();
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
			<div ref={containerRef} className="min-h-0 flex-1" />
		</section>
	);
}
