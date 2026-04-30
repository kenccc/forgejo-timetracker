(function () {
    const goalStorageKey = "planka-time-goal-hours";
    const rateStorageKey = "planka-hourly-rate";
    const userStorageKey = "planka-selected-user";
    const themeStorageKey = "planka-theme";
    const savedRangesKey = "planka-saved-ranges";
    const widgetsStorageKey = "planka-widget-visibility";
    let latestSummaryData = null;
    let latestSince = null;
    let latestBefore = null;
    let breakdownMode = "day";
    let plankaUsers = [];
    let autoRefreshInterval = null;
    let trendViewMode = "daily";

    const DONUT_COLORS = ["#3a8fd1", "#6dbf8a", "#d4b87a", "#d47a7a", "#a78bfa", "#5aaee8", "#8b6dbf", "#bf8b6d"];

    function initIcons() {
        if (window.lucide) {
            window.lucide.createIcons();
        }
    }

    function byId(id) {
        return document.getElementById(id);
    }

    function toISO(dateStr, end) {
        if (!dateStr) return null;
        return end ? `${dateStr}T23:59:59Z` : `${dateStr}T00:00:00Z`;
    }

    function toInputDate(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, "0");
        const day = String(date.getDate()).padStart(2, "0");
        return `${year}-${month}-${day}`;
    }

    function formatDuration(hours, minutes) {
        return `${hours}h ${minutes}m`;
    }

    function formatDayLabel(dateStr) {
        return new Date(`${dateStr}T00:00:00Z`).toLocaleDateString("en-GB", {
            day: "numeric",
            month: "short",
            year: "numeric",
        });
    }

    function showError(message) {
        byId("errorText").textContent = message;
        byId("errorMsg").classList.add("visible");
        byId("result").classList.remove("visible");
    }

    function hideError() {
        byId("errorMsg").classList.remove("visible");
    }

    function parsePositiveNumber(value) {
        const number = Number(value);
        return Number.isFinite(number) && number > 0 ? number : null;
    }

    function parseGoalHours() {
        return parsePositiveNumber(byId("goalHours").value);
    }

    function parseHourlyRate() {
        return parsePositiveNumber(byId("hourlyRate").value);
    }

    function formatSignedDuration(parts) {
        const prefix = parts.sign < 0 ? "-" : "+";
        return `${prefix}${parts.hours}h ${parts.minutes}m`;
    }

    function setPresetRange(days) {
        const today = new Date();
        const since = new Date(today);
        since.setDate(since.getDate() - (days - 1));
        byId("since").value = toInputDate(since);
        byId("before").value = toInputDate(today);
    }

    function setCurrentMonth() {
        const today = new Date();
        const from = new Date(today.getFullYear(), today.getMonth(), 1);
        byId("since").value = toInputDate(from);
        byId("before").value = toInputDate(today);
    }

    function setThisWeek() {
        const today = new Date();
        const day = today.getDay();
        const deltaToMonday = day === 0 ? 6 : day - 1;
        const from = new Date(today);
        from.setDate(today.getDate() - deltaToMonday);
        byId("since").value = toInputDate(from);
        byId("before").value = toInputDate(today);
    }

    function setThisQuarter() {
        const today = new Date();
        const quarter = Math.floor(today.getMonth() / 3);
        const from = new Date(today.getFullYear(), quarter * 3, 1);
        byId("since").value = toInputDate(from);
        byId("before").value = toInputDate(today);
    }

    function setThisYear() {
        const today = new Date();
        const from = new Date(today.getFullYear(), 0, 1);
        byId("since").value = toInputDate(from);
        byId("before").value = toInputDate(today);
    }

    function showToast(message, type) {
        const container = byId("toastContainer");
        const toast = document.createElement("div");
        toast.className = `toast toast-${type || "info"}`;
        toast.textContent = message;
        container.appendChild(toast);
        setTimeout(() => {
            toast.classList.add("toast-out");
            setTimeout(() => toast.remove(), 300);
        }, 2500);
    }

    function renderDailyChart(rows) {
        const chart = byId("dailyChart");
        chart.innerHTML = "";
        if (!rows.length) return;
        const peak = Math.max(...rows.map((row) => row.total_seconds), 1);
        rows.forEach((row) => {
            const bar = document.createElement("div");
            bar.className = "chart-bar";
            bar.style.height = `${Math.max(4, (row.total_seconds / peak) * 100)}%`;
            bar.title = `${formatDayLabel(row.date)}: ${formatDuration(row.hours, row.minutes)}`;
            chart.appendChild(bar);
        });
    }

    function renderDailyBreakdown(rows) {
        const container = byId("dailyBreakdown");
        container.innerHTML = "";
        if (!rows.length) {
            const row = document.createElement("div");
            row.className = "daily-row";
            row.innerHTML = '<span class="daily-date">No tracked time in this range.</span>';
            container.appendChild(row);
            return;
        }
        rows.forEach((day) => {
            const row = document.createElement("div");
            row.className = "daily-row";
            row.innerHTML = `<span class="daily-date">${formatDayLabel(day.date)}</span><span class="daily-time">${formatDuration(day.hours, day.minutes)}</span>`;
            container.appendChild(row);
        });
    }

    function renderTopDays(topDays) {
        const list = byId("topDaysList");
        list.innerHTML = "";
        if (!topDays.length) {
            list.innerHTML = "<li>No tracked days in this range.</li>";
            return;
        }
        topDays.forEach((day) => {
            const item = document.createElement("li");
            item.textContent = `${formatDayLabel(day.date)} - ${formatDuration(day.hours, day.minutes)}`;
            list.appendChild(item);
        });
    }

    function renderWeeklyBreakdown(rows) {
        const list = byId("weeklyBreakdown");
        list.innerHTML = "";
        if (!rows.length) {
            list.innerHTML = "<li>No weekly data.</li>";
            return;
        }
        rows.slice().reverse().forEach((week) => {
            const item = document.createElement("li");
            item.textContent = `Week of ${formatDayLabel(week.week_start)} - ${formatDuration(week.hours, week.minutes)}`;
            list.appendChild(item);
        });
    }

    function renderIssueBreakdown(rows, filter) {
        const container = byId("issueBreakdown");
        container.innerHTML = "";
        let filtered = rows;
        if (filter) {
            const q = filter.toLowerCase();
            filtered = rows.filter((r) => r.issue.toLowerCase().includes(q));
        }
        if (!filtered.length) {
            const row = document.createElement("div");
            row.className = "daily-row";
            row.innerHTML = '<span class="daily-date">No card data in this range.</span>';
            container.appendChild(row);
            return;
        }
        filtered.forEach((row) => {
            const item = document.createElement("div");
            item.className = "daily-row";
            const issue = document.createElement("span");
            issue.className = "daily-date";
            issue.textContent = row.issue;
            const time = document.createElement("span");
            time.className = "daily-time";
            time.textContent = formatDuration(row.hours, row.minutes);
            item.appendChild(issue);
            item.appendChild(time);
            container.appendChild(item);
        });
    }

    function renderProjectBreakdown(rows, filter) {
        const container = byId("projectBreakdown");
        container.innerHTML = "";
        let filtered = rows;
        if (filter) {
            const q = filter.toLowerCase();
            filtered = rows.filter((r) => r.project.toLowerCase().includes(q));
        }
        if (!filtered.length) {
            const row = document.createElement("div");
            row.className = "daily-row";
            row.innerHTML = '<span class="daily-date">No project data in this range.</span>';
            container.appendChild(row);
            return;
        }
        filtered.forEach((row) => {
            const item = document.createElement("div");
            item.className = "daily-row";
            const proj = document.createElement("span");
            proj.className = "daily-date";
            proj.textContent = row.project;
            const time = document.createElement("span");
            time.className = "daily-time";
            time.textContent = formatDuration(row.hours, row.minutes);
            item.appendChild(proj);
            item.appendChild(time);
            container.appendChild(item);
        });
    }

    function renderBreakdownMode() {
        const isIssueMode = breakdownMode === "issue";
        const isProjectMode = breakdownMode === "project";
        byId("dailyBreakdown").classList.toggle("hidden", isIssueMode || isProjectMode);
        byId("issueBreakdown").classList.toggle("hidden", !isIssueMode);
        byId("projectBreakdown").classList.toggle("hidden", !isProjectMode);
        byId("byDayBtn").classList.toggle("active", !isIssueMode && !isProjectMode);
        byId("byIssueBtn").classList.toggle("active", isIssueMode);
        byId("byProjectBtn").classList.toggle("active", isProjectMode);
        const searchBar = byId("searchBar");
        searchBar.classList.toggle("visible", isIssueMode || isProjectMode);
    }

    function renderGoalProgress(data) {
        const goal = parseGoalHours();
        if (!goal) {
            byId("goalProgressText").textContent = "Set a goal to track progress";
            byId("goalProgressBar").style.width = "0%";
            return;
        }
        const totalHours = (data.total_seconds || 0) / 3600;
        const progress = Math.min(100, (totalHours / goal) * 100);
        byId("goalProgressText").textContent = `${totalHours.toFixed(1)} / ${goal.toFixed(1)} h (${progress.toFixed(1)}%)`;
        byId("goalProgressBar").style.width = `${progress}%`;
    }

    function renderSalary(data) {
        const rate = parseHourlyRate();
        if (!rate) {
            byId("salaryValue").textContent = "Set rate";
            return;
        }
        const salary = ((data.total_seconds || 0) / 3600) * rate;
        byId("salaryValue").textContent = salary.toFixed(2);
    }

    function renderComparison(comparison) {
        const valueEl = byId("comparisonValue");
        const subEl = byId("comparisonSub");
        valueEl.classList.remove("up", "down");
        if (!comparison) {
            valueEl.textContent = "Unavailable";
            subEl.textContent = "Previous period data could not be loaded.";
            return;
        }
        valueEl.textContent = formatSignedDuration(comparison.delta);
        if (comparison.direction === "up") valueEl.classList.add("up");
        if (comparison.direction === "down") valueEl.classList.add("down");
        const percent = comparison.delta_percent === null ? "n/a" : `${comparison.delta_percent}%`;
        subEl.textContent = `${formatDayLabel(comparison.previous_since)} - ${formatDayLabel(comparison.previous_before)} (${percent})`;
    }

    function renderHeatmap(heatmapData) {
        const container = byId("heatmapContainer");
        container.innerHTML = "";
        if (!heatmapData.length) return;
        const maxSeconds = Math.max(...heatmapData.map((d) => d.total_seconds), 1);
        const weeks = [];
        let currentWeek = [];
        heatmapData.forEach((entry) => {
            if (currentWeek.length === 0 || entry.weekday === 0) {
                if (currentWeek.length > 0) weeks.push(currentWeek);
                currentWeek = [];
            }
            while (currentWeek.length < entry.weekday) {
                const blank = document.createElement("div");
                blank.className = "heatmap-day";
                blank.style.visibility = "hidden";
                currentWeek.push(blank);
            }
            const level = entry.total_seconds === 0 ? 0 : entry.total_seconds < maxSeconds * 0.25 ? 1 : entry.total_seconds < maxSeconds * 0.5 ? 2 : entry.total_seconds < maxSeconds * 0.75 ? 3 : 4;
            const day = document.createElement("div");
            day.className = "heatmap-day";
            day.setAttribute("data-level", level);
            const h = Math.round(entry.total_seconds / 3600);
            const m = Math.round((entry.total_seconds % 3600) / 60);
            day.title = `${formatDayLabel(entry.date)}: ${h}h ${m}m`;
            currentWeek.push(day);
        });
        if (currentWeek.length > 0) weeks.push(currentWeek);
        weeks.forEach((week) => {
            const weekEl = document.createElement("div");
            weekEl.className = "heatmap-week";
            week.forEach((day) => weekEl.appendChild(day));
            container.appendChild(weekEl);
        });
    }

    function renderTrendChart(trendData) {
        const container = byId("trendChart");
        container.innerHTML = "";
        if (!trendData.length) return;
        let data = trendData;
        if (trendViewMode === "weekly") {
            const weeks = {};
            trendData.forEach((d) => {
                const dt = new Date(`${d.date}T00:00:00Z`);
                const day = dt.getDay();
                const deltaToMonday = day === 0 ? 6 : day - 1;
                const monday = new Date(dt);
                monday.setDate(dt.getDate() - deltaToMonday);
                const key = monday.toISOString().slice(0, 10);
                if (!weeks[key]) weeks[key] = { total: 0, count: 0 };
                weeks[key].total += d.hours;
                weeks[key].count++;
            });
            data = Object.entries(weeks).map(([date, v]) => ({ date, hours: Math.round(v.total * 100) / 100, moving_avg: Math.round(v.total * 100) / 100 }));
        } else if (trendViewMode === "monthly") {
            const months = {};
            trendData.forEach((d) => {
                const key = d.date.slice(0, 7);
                if (!months[key]) months[key] = 0;
                months[key] += d.hours;
            });
            data = Object.entries(months).map(([date, hours]) => ({ date, hours: Math.round(hours * 100) / 100, moving_avg: Math.round(hours * 100) / 100 }));
        }
        if (!data.length) return;
        const width = Math.max(300, data.length * 8);
        const height = 120;
        const padding = 20;
        const maxH = Math.max(...data.map((d) => Math.max(d.hours, d.moving_avg)), 1);
        const svgNS = "http://www.w3.org/2000/svg";
        const svg = document.createElementNS(svgNS, "svg");
        svg.setAttribute("width", width);
        svg.setAttribute("height", height);
        svg.classList.add("trend-svg");
        const points = data.map((d, i) => {
            const x = padding + (i / Math.max(data.length - 1, 1)) * (width - padding * 2);
            const y = height - padding - (d.hours / maxH) * (height - padding * 2);
            return { x, y };
        });
        const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
        const line = document.createElementNS(svgNS, "path");
        line.setAttribute("d", linePath);
        line.setAttribute("fill", "none");
        line.setAttribute("stroke", "var(--accent)");
        line.setAttribute("stroke-width", "1.5");
        svg.appendChild(line);
        if (trendViewMode === "daily" && data.length > 1) {
            const maPoints = data.map((d, i) => {
                const x = padding + (i / Math.max(data.length - 1, 1)) * (width - padding * 2);
                const y = height - padding - (d.moving_avg / maxH) * (height - padding * 2);
                return { x, y };
            });
            const maPath = maPoints.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
            const maLine = document.createElementNS(svgNS, "path");
            maLine.setAttribute("d", maPath);
            maLine.setAttribute("fill", "none");
            maLine.setAttribute("stroke", "var(--green)");
            maLine.setAttribute("stroke-width", "1");
            maLine.setAttribute("stroke-dasharray", "4,3");
            svg.appendChild(maLine);
        }
        points.forEach((p, i) => {
            const circle = document.createElementNS(svgNS, "circle");
            circle.setAttribute("cx", p.x);
            circle.setAttribute("cy", p.y);
            circle.setAttribute("r", "2");
            circle.setAttribute("fill", "var(--accent)");
            circle.setAttribute("opacity", "0.6");
            svg.appendChild(circle);
        });
        container.appendChild(svg);
    }

    function renderDonutChart(projectBreakdown) {
        const chartEl = byId("donutChart");
        const legendEl = byId("donutLegend");
        chartEl.innerHTML = "";
        legendEl.innerHTML = "";
        if (!projectBreakdown.length) {
            chartEl.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--stone-500);font-size:0.6rem;">No project data</div>';
            return;
        }
        const total = projectBreakdown.reduce((s, p) => s + p.total_seconds, 0);
        const size = 120;
        const cx = size / 2;
        const cy = size / 2;
        const r = 45;
        const innerR = 30;
        const svgNS = "http://www.w3.org/2000/svg";
        const svg = document.createElementNS(svgNS, "svg");
        svg.setAttribute("width", size);
        svg.setAttribute("height", size);
        let cumulative = 0;
        projectBreakdown.slice(0, 8).forEach((proj, i) => {
            const fraction = proj.total_seconds / total;
            const startAngle = cumulative * 2 * Math.PI - Math.PI / 2;
            cumulative += fraction;
            const endAngle = cumulative * 2 * Math.PI - Math.PI / 2;
            const largeArc = fraction > 0.5 ? 1 : 0;
            const x1 = cx + r * Math.cos(startAngle);
            const y1 = cy + r * Math.sin(startAngle);
            const x2 = cx + r * Math.cos(endAngle);
            const y2 = cy + r * Math.sin(endAngle);
            const ix1 = cx + innerR * Math.cos(endAngle);
            const iy1 = cy + innerR * Math.sin(endAngle);
            const ix2 = cx + innerR * Math.cos(startAngle);
            const iy2 = cy + innerR * Math.sin(startAngle);
            const d = `M${x1},${y1} A${r},${r} 0 ${largeArc} 1 ${x2},${y2} L${ix1},${iy1} A${innerR},${innerR} 0 ${largeArc} 0 ${ix2},${iy2} Z`;
            const path = document.createElementNS(svgNS, "path");
            path.setAttribute("d", d);
            path.setAttribute("fill", DONUT_COLORS[i % DONUT_COLORS.length]);
            path.setAttribute("stroke", "var(--bg-surface)");
            path.setAttribute("stroke-width", "1");
            path.style.cursor = "default";
            path.title = `${proj.project}: ${formatDuration(proj.hours, proj.minutes)}`;
            svg.appendChild(path);
            const item = document.createElement("div");
            item.className = "donut-legend-item";
            item.innerHTML = `<span class="donut-legend-color" style="background:${DONUT_COLORS[i % DONUT_COLORS.length]}"></span><span class="donut-legend-label" title="${proj.project}">${proj.project}</span><span class="donut-legend-value">${Math.round(fraction * 100)}%</span>`;
            legendEl.appendChild(item);
        });
        if (projectBreakdown.length > 8) {
            const item = document.createElement("div");
            item.className = "donut-legend-item";
            item.innerHTML = `<span class="donut-legend-color" style="background:var(--stone-500)"></span><span class="donut-legend-label">+${projectBreakdown.length - 8} more</span>`;
            legendEl.appendChild(item);
        }
        chartEl.appendChild(svg);
    }

    function renderWeekdayDistribution(hourlyDist) {
        const container = byId("weekdayChart");
        container.innerHTML = "";
        if (!hourlyDist.length) return;
        const maxH = Math.max(...hourlyDist.map((d) => d.hours), 1);
        hourlyDist.forEach((d) => {
            const wrap = document.createElement("div");
            wrap.className = "weekday-bar-wrap";
            const hoursLabel = document.createElement("div");
            hoursLabel.className = "weekday-hours";
            hoursLabel.textContent = `${d.hours}h`;
            const bar = document.createElement("div");
            bar.className = "weekday-bar";
            bar.style.height = `${Math.max(4, (d.hours / maxH) * 100)}%`;
            bar.title = `${d.day}: ${d.hours}h (${d.share_percent}%)`;
            const label = document.createElement("div");
            label.className = "weekday-label";
            label.textContent = d.day;
            wrap.appendChild(hoursLabel);
            wrap.appendChild(bar);
            wrap.appendChild(label);
            container.appendChild(wrap);
        });
    }

    function renderSummary(data, sinceVal, beforeVal) {
        byId("resultValue").innerHTML = `${data.hours}<span>h</span> ${data.minutes}<span>m</span>`;
        byId("resultMeta").textContent = `${formatDayLabel(sinceVal)} - ${formatDayLabel(beforeVal)}`;
        byId("avgPerDay").textContent = formatDuration(data.average_per_day_hours || 0, data.average_per_day_minutes || 0);
        byId("busiestDay").textContent = data.busiest_day
            ? `${formatDayLabel(data.busiest_day.date)} (${formatDuration(data.busiest_day.hours, data.busiest_day.minutes)})`
            : "No tracked time";
        const insights = data.insights || {};
        byId("activeDays").textContent = `${insights.active_days || 0}/${data.days_count || 0} (${insights.activity_rate_percent || 0}%)`;
        byId("streaks").textContent = `Current ${insights.current_streak_days || 0}d · Best ${insights.longest_streak_days || 0}d`;
        byId("weekdayWeekend").textContent = `${formatDuration(insights.weekday?.hours || 0, insights.weekday?.minutes || 0)} / ${formatDuration(insights.weekend?.hours || 0, insights.weekend?.minutes || 0)}`;
        byId("consistency").textContent = `Weekday share ${insights.weekday_share_percent || 0}%`;
        renderComparison(data.comparison);
        renderGoalProgress(data);
        renderSalary(data);
        renderTopDays(data.top_days || []);
        renderWeeklyBreakdown(data.weekly_breakdown || []);
        renderIssueBreakdown(data.issue_breakdown || []);
        renderProjectBreakdown(data.advanced?.project_breakdown || []);
        renderDailyChart(data.daily_breakdown || []);
        renderDailyBreakdown(data.daily_breakdown || []);
        renderBreakdownMode();
        const adv = data.advanced || {};
        renderHeatmap(adv.heatmap || []);
        renderTrendChart(adv.trend || []);
        renderDonutChart(adv.project_breakdown || []);
        renderWeekdayDistribution(adv.hourly_distribution || []);
        byId("result").classList.add("visible");
        byId("exportBtn").disabled = false;
        byId("exportCsvBtn").disabled = false;
        byId("copySummaryBtn").disabled = false;
        byId("reportBtn").disabled = false;
        initIcons();
    }

    async function fetchTime() {
        hideError();
        const sinceVal = byId("since").value;
        const beforeVal = byId("before").value;
        const since = toISO(sinceVal, false);
        const before = toISO(beforeVal, true);
        if (!since || !before) return showError("Please select both dates.");
        if (sinceVal > beforeVal) return showError("Start date must be before end date.");

        const btn = byId("calcBtn");
        btn.disabled = true;
        btn.innerHTML = '<i data-lucide="loader-2"></i>Calculating...';
        initIcons();

        try {
            const username = byId("userSelect").value;
            const includeWeekends = byId("includeWeekends").checked;
            const query = new URLSearchParams({ since, before, include_weekends: includeWeekends ? "1" : "0" });
            if (username) query.set("username", username);
            const res = await fetch(`/api/time-summary/?${query.toString()}`);
            if (!res.ok) {
                const body = await res.json().catch(() => null);
                throw new Error(body?.error || `Server error ${res.status}`);
            }
            const data = await res.json();
            latestSummaryData = data;
            latestSince = sinceVal;
            latestBefore = beforeVal;
            renderSummary(data, sinceVal, beforeVal);
        } catch (error) {
            showError(error.message || "Unable to retrieve data. Please try again.");
            latestSummaryData = null;
            latestSince = null;
            latestBefore = null;
            byId("exportBtn").disabled = true;
            byId("exportCsvBtn").disabled = true;
            byId("copySummaryBtn").disabled = true;
            byId("reportBtn").disabled = true;
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i data-lucide="clock-4"></i>Calculate';
            initIcons();
        }
    }

    function exportExcel() {
        if (!latestSummaryData?.daily_breakdown) return showError("No data to export yet. Calculate first.");
        const rows = latestSummaryData.daily_breakdown.map((day) => ({
            Date: formatDayLabel(day.date),
            Hours: day.hours,
            Minutes: day.minutes,
            "Total (h:mm)": formatDuration(day.hours, day.minutes),
            "Total Seconds": day.total_seconds,
        }));
        rows.push({
            Date: "TOTAL",
            Hours: latestSummaryData.hours || 0,
            Minutes: latestSummaryData.minutes || 0,
            "Total (h:mm)": formatDuration(latestSummaryData.hours || 0, latestSummaryData.minutes || 0),
            "Total Seconds": latestSummaryData.total_seconds || 0,
        });
        const ws = window.XLSX.utils.json_to_sheet(rows);
        const wb = window.XLSX.utils.book_new();
        window.XLSX.utils.book_append_sheet(wb, ws, "Time Summary");
        const issueRows = (latestSummaryData.issue_breakdown || []).map((row) => ({
            Card: row.issue,
            Hours: row.hours,
            Minutes: row.minutes,
            "Total (h:mm)": formatDuration(row.hours, row.minutes),
            "Total Seconds": row.total_seconds,
        }));
        if (issueRows.length) {
            const issueSheet = window.XLSX.utils.json_to_sheet(issueRows);
            window.XLSX.utils.book_append_sheet(wb, issueSheet, "By Card");
        }
        const projRows = (latestSummaryData.advanced?.project_breakdown || []).map((row) => ({
            Project: row.project,
            Hours: row.hours,
            Minutes: row.minutes,
            "Total (h:mm)": formatDuration(row.hours, row.minutes),
            "Total Seconds": row.total_seconds,
        }));
        if (projRows.length) {
            const projSheet = window.XLSX.utils.json_to_sheet(projRows);
            window.XLSX.utils.book_append_sheet(wb, projSheet, "By Project");
        }
        const safeSince = (latestSince || "since").replaceAll("-", "");
        const safeBefore = (latestBefore || "before").replaceAll("-", "");
        window.XLSX.writeFile(wb, `time-summary-${safeSince}-${safeBefore}.xlsx`);
        showToast("Excel exported successfully", "success");
    }

    function exportCsv() {
        if (!latestSummaryData?.daily_breakdown) return showError("No data to export yet. Calculate first.");
        let csv = "Date,Hours,Minutes,Total Seconds\n";
        latestSummaryData.daily_breakdown.forEach((day) => {
            csv += `${day.date},${day.hours},${day.minutes},${day.total_seconds}\n`;
        });
        csv += `\nTOTAL,${latestSummaryData.hours || 0},${latestSummaryData.minutes || 0},${latestSummaryData.total_seconds || 0}\n`;
        if (latestSummaryData.issue_breakdown?.length) {
            csv += "\nCard,Hours,Minutes,Total Seconds\n";
            latestSummaryData.issue_breakdown.forEach((row) => {
                csv += `"${row.issue}",${row.hours},${row.minutes},${row.total_seconds}\n`;
            });
        }
        const blob = new Blob([csv], { type: "text/csv" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `time-summary-${latestSince}-${latestBefore}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        showToast("CSV exported successfully", "success");
    }

    async function copySummary() {
        if (!latestSummaryData) return;
        const text = [
            `Time summary: ${formatDuration(latestSummaryData.hours, latestSummaryData.minutes)}`,
            `Period: ${formatDayLabel(latestSince)} - ${formatDayLabel(latestBefore)}`,
            `Average/day: ${formatDuration(latestSummaryData.average_per_day_hours, latestSummaryData.average_per_day_minutes)}`,
            `Active days: ${latestSummaryData.insights?.active_days || 0}/${latestSummaryData.days_count || 0}`,
            ...(latestSummaryData.issue_breakdown || [])
                .slice(0, 5)
                .map((row) => `${row.issue}: ${formatDuration(row.hours, row.minutes)}`),
        ].join("\n");
        try {
            await navigator.clipboard.writeText(text);
            byId("copySummaryBtn").textContent = "Copied";
            setTimeout(() => { byId("copySummaryBtn").innerHTML = '<i data-lucide="clipboard-copy"></i>Copy summary'; initIcons(); }, 1200);
            showToast("Summary copied to clipboard", "success");
        } catch (_error) {
            showError("Clipboard access failed.");
        }
    }

    function generateReport() {
        if (!latestSummaryData) return;
        const data = latestSummaryData;
        const insights = data.insights || {};
        const totalHours = (data.total_seconds || 0) / 3600;
        const rate = parseHourlyRate();
        let reportHtml = `
            <div class="report-section">
                <h4>Overview</h4>
                <table class="report-table">
                    <tr><th>Metric</th><th>Value</th></tr>
                    <tr><td>Total Time</td><td>${formatDuration(data.hours, data.minutes)}</td></tr>
                    <tr><td>Period</td><td>${formatDayLabel(latestSince)} - ${formatDayLabel(latestBefore)}</td></tr>
                    <tr><td>Days Count</td><td>${data.days_count}</td></tr>
                    <tr><td>Average / Day</td><td>${formatDuration(data.average_per_day_hours, data.average_per_day_minutes)}</td></tr>
                    <tr><td>Active Days</td><td>${insights.active_days || 0} / ${data.days_count} (${insights.activity_rate_percent || 0}%)</td></tr>
                    <tr><td>Current Streak</td><td>${insights.current_streak_days || 0} days</td></tr>
                    <tr><td>Longest Streak</td><td>${insights.longest_streak_days || 0} days</td></tr>
                    ${rate ? `<tr><td>Estimated Earnings</td><td>${(totalHours * rate).toFixed(2)}</td></tr>` : ""}
                </table>
            </div>
        `;
        if (data.comparison) {
            const comp = data.comparison;
            reportHtml += `
                <div class="report-section">
                    <h4>Period Comparison</h4>
                    <table class="report-table">
                        <tr><th>Metric</th><th>Value</th></tr>
                        <tr><td>Delta</td><td>${formatSignedDuration(comp.delta)}</td></tr>
                        <tr><td>Delta %</td><td>${comp.delta_percent === null ? "n/a" : comp.delta_percent + "%"}</td></tr>
                        <tr><td>Direction</td><td>${comp.direction === "up" ? "↑ Increase" : comp.direction === "down" ? "↓ Decrease" : "→ Flat"}</td></tr>
                        <tr><td>Previous Period</td><td>${formatDayLabel(comp.previous_since)} - ${formatDayLabel(comp.previous_before)}</td></tr>
                    </table>
                </div>
            `;
        }
        if (data.advanced?.project_breakdown?.length) {
            reportHtml += `
                <div class="report-section">
                    <h4>Time by Project</h4>
                    <table class="report-table">
                        <tr><th>Project</th><th>Hours</th><th>Share</th></tr>
                        ${data.advanced.project_breakdown.map((p) => `<tr><td>${p.project}</td><td>${formatDuration(p.hours, p.minutes)}</td><td>${Math.round((p.total_seconds / data.total_seconds) * 100)}%</td></tr>`).join("")}
                    </table>
                </div>
            `;
        }
        if (data.advanced?.hourly_distribution?.length) {
            reportHtml += `
                <div class="report-section">
                    <h4>Weekday Distribution</h4>
                    <table class="report-table">
                        <tr><th>Day</th><th>Hours</th><th>Share</th></tr>
                        ${data.advanced.hourly_distribution.map((d) => `<tr><td>${d.day}</td><td>${d.hours}h</td><td>${d.share_percent}%</td></tr>`).join("")}
                    </table>
                </div>
            `;
        }
        if (data.issue_breakdown?.length) {
            reportHtml += `
                <div class="report-section">
                    <h4>Top Cards</h4>
                    <table class="report-table">
                        <tr><th>Card</th><th>Hours</th></tr>
                        ${data.issue_breakdown.slice(0, 10).map((r) => `<tr><td>${r.issue}</td><td>${formatDuration(r.hours, r.minutes)}</td></tr>`).join("")}
                    </table>
                </div>
            `;
        }
        byId("reportContent").innerHTML = reportHtml;
        byId("reportModal").classList.remove("hidden");
        initIcons();
    }

    function persistInput(key, inputId) {
        const value = byId(inputId).value.trim();
        if (!value) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
    }

    async function loadPlankaUsers() {
        try {
            const res = await fetch("/api/users/");
            if (!res.ok) return;
            const data = await res.json();
            plankaUsers = data.users || [];
            const select = byId("userSelect");
            plankaUsers.forEach((user) => {
                const option = document.createElement("option");
                option.value = user.username;
                option.textContent = user.full_name !== user.username ? `${user.full_name} (${user.username})` : user.username;
                select.appendChild(option);
            });
        } catch {
        }
    }

    function loadSavedValues() {
        const savedGoal = localStorage.getItem(goalStorageKey);
        const savedRate = localStorage.getItem(rateStorageKey);
        const savedUser = localStorage.getItem(userStorageKey);
        if (savedGoal) byId("goalHours").value = savedGoal;
        if (savedRate) byId("hourlyRate").value = savedRate;
        if (savedUser) byId("userSelect").value = savedUser;
    }

    function loadSavedRanges() {
        try {
            const ranges = JSON.parse(localStorage.getItem(savedRangesKey) || "[]");
            const container = byId("savedRangesList");
            container.innerHTML = "";
            ranges.forEach((r, i) => {
                const chip = document.createElement("div");
                chip.className = "saved-range-chip";
                chip.innerHTML = `<span>${r.label}</span><span class="remove-saved" data-idx="${i}"><i data-lucide="x" style="width:10px;height:10px"></i></span>`;
                chip.addEventListener("click", (e) => {
                    if (e.target.closest(".remove-saved")) return;
                    byId("since").value = r.since;
                    byId("before").value = r.before;
                    fetchTime();
                });
                container.appendChild(chip);
            });
            container.querySelectorAll(".remove-saved").forEach((btn) => {
                btn.addEventListener("click", (e) => {
                    e.stopPropagation();
                    const idx = parseInt(btn.dataset.idx);
                    const ranges = JSON.parse(localStorage.getItem(savedRangesKey) || "[]");
                    ranges.splice(idx, 1);
                    localStorage.setItem(savedRangesKey, JSON.stringify(ranges));
                    loadSavedRanges();
                });
            });
            initIcons();
        } catch {
        }
    }

    function saveCurrentRange() {
        const since = byId("since").value;
        const before = byId("before").value;
        if (!since || !before) return showToast("Set dates first", "error");
        const label = `${since} → ${before}`;
        const ranges = JSON.parse(localStorage.getItem(savedRangesKey) || "[]");
        if (ranges.some((r) => r.since === since && r.before === before)) return showToast("Range already saved", "info");
        ranges.push({ label, since, before });
        localStorage.setItem(savedRangesKey, JSON.stringify(ranges));
        loadSavedRanges();
        showToast("Range saved", "success");
    }

    function loadTheme() {
        const theme = localStorage.getItem(themeStorageKey);
        if (theme === "light") {
            document.documentElement.classList.add("light");
        }
    }

    function toggleTheme() {
        const isLight = document.documentElement.classList.toggle("light");
        localStorage.setItem(themeStorageKey, isLight ? "light" : "dark");
    }

    function loadWidgetVisibility() {
        try {
            const widgets = JSON.parse(localStorage.getItem(widgetsStorageKey) || "{}");
            Object.entries(widgets).forEach(([id, visible]) => {
                const el = byId(id);
                if (el) el.style.display = visible ? "" : "none";
                const checkbox = document.querySelector(`[data-widget="${id}"]`);
                if (checkbox) checkbox.checked = visible;
            });
        } catch {
        }
    }

    function setupAutoRefresh(enabled) {
        if (autoRefreshInterval) {
            clearInterval(autoRefreshInterval);
            autoRefreshInterval = null;
        }
        if (enabled && latestSummaryData) {
            autoRefreshInterval = setInterval(() => {
                fetchTime();
            }, 5 * 60 * 1000);
        }
    }

    function attachEvents() {
        byId("calcBtn").addEventListener("click", fetchTime);
        byId("exportBtn").addEventListener("click", exportExcel);
        byId("exportCsvBtn").addEventListener("click", exportCsv);
        byId("copySummaryBtn").addEventListener("click", copySummary);
        byId("reportBtn").addEventListener("click", generateReport);
        byId("goalHours").addEventListener("input", () => {
            persistInput(goalStorageKey, "goalHours");
            if (latestSummaryData) renderGoalProgress(latestSummaryData);
        });
        byId("hourlyRate").addEventListener("input", () => {
            persistInput(rateStorageKey, "hourlyRate");
            if (latestSummaryData) renderSalary(latestSummaryData);
        });
        byId("byDayBtn").addEventListener("click", () => {
            breakdownMode = "day";
            renderBreakdownMode();
        });
        byId("byIssueBtn").addEventListener("click", () => {
            breakdownMode = "issue";
            renderBreakdownMode();
        });
        byId("byProjectBtn").addEventListener("click", () => {
            breakdownMode = "project";
            renderBreakdownMode();
        });
        byId("userSelect").addEventListener("change", () => {
            persistInput(userStorageKey, "userSelect");
        });
        byId("searchInput").addEventListener("input", () => {
            const q = byId("searchInput").value;
            if (breakdownMode === "issue") {
                renderIssueBreakdown(latestSummaryData?.issue_breakdown || [], q);
            } else if (breakdownMode === "project") {
                renderProjectBreakdown(latestSummaryData?.advanced?.project_breakdown || [], q);
            }
        });
        document.querySelectorAll(".quick-range-btn").forEach((button) => {
            button.addEventListener("click", () => {
                const range = button.dataset.range;
                if (range === "month") setCurrentMonth();
                else if (range === "week") setThisWeek();
                else if (range === "quarter") setThisQuarter();
                else if (range === "year") setThisYear();
                else setPresetRange(Number(range));
            });
        });
        byId("themeToggle").addEventListener("click", toggleTheme);
        byId("saveRangeBtn").addEventListener("click", saveCurrentRange);
        byId("widgetToggle").addEventListener("click", () => {
            byId("widgetModal").classList.remove("hidden");
        });
        byId("closeShortcuts").addEventListener("click", () => {
            byId("shortcutModal").classList.add("hidden");
        });
        byId("closeWidgetModal").addEventListener("click", () => {
            byId("widgetModal").classList.add("hidden");
        });
        byId("closeReportModal").addEventListener("click", () => {
            byId("reportModal").classList.add("hidden");
        });
        byId("copyReportBtn").addEventListener("click", () => {
            const text = byId("reportContent").innerText;
            navigator.clipboard.writeText(text).then(() => showToast("Report copied", "success"));
        });
        document.querySelectorAll(".modal-overlay").forEach((overlay) => {
            overlay.addEventListener("click", (e) => {
                if (e.target === overlay) overlay.classList.add("hidden");
            });
        });
        document.querySelectorAll(".widget-toggle-item input").forEach((cb) => {
            cb.addEventListener("change", () => {
                const widgetId = cb.dataset.widget;
                const el = byId(widgetId);
                if (el) el.style.display = cb.checked ? "" : "none";
                try {
                    const widgets = JSON.parse(localStorage.getItem(widgetsStorageKey) || "{}");
                    widgets[widgetId] = cb.checked;
                    localStorage.setItem(widgetsStorageKey, JSON.stringify(widgets));
                } catch {
                }
            });
        });
        document.querySelectorAll(".trend-toggle-btn").forEach((btn) => {
            btn.addEventListener("click", () => {
                document.querySelectorAll(".trend-toggle-btn").forEach((b) => b.classList.remove("active"));
                btn.classList.add("active");
                trendViewMode = btn.dataset.view;
                if (latestSummaryData?.advanced?.trend) {
                    renderTrendChart(latestSummaryData.advanced.trend);
                }
            });
        });
        byId("autoRefresh").addEventListener("change", () => {
            setupAutoRefresh(byId("autoRefresh").checked);
        });
    }

    function setupKeyboardShortcuts() {
        document.addEventListener("keydown", (e) => {
            if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.tagName === "SELECT") {
                if (e.key === "Escape") {
                    e.target.blur();
                    document.querySelectorAll(".modal-overlay").forEach((m) => m.classList.add("hidden"));
                    byId("searchInput").value = "";
                    if (latestSummaryData) {
                        if (breakdownMode === "issue") renderIssueBreakdown(latestSummaryData.issue_breakdown || []);
                        else if (breakdownMode === "project") renderProjectBreakdown(latestSummaryData.advanced?.project_breakdown || []);
                    }
                }
                return;
            }
            if (e.key === "?" || (e.key === "/" && !e.ctrlKey && !e.metaKey)) {
                e.preventDefault();
                byId("shortcutModal").classList.toggle("hidden");
                initIcons();
                return;
            }
            if (e.key === "Escape") {
                document.querySelectorAll(".modal-overlay").forEach((m) => m.classList.add("hidden"));
                return;
            }
            if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                e.preventDefault();
                fetchTime();
                return;
            }
            if ((e.ctrlKey || e.metaKey) && e.key === "k") {
                e.preventDefault();
                if (breakdownMode === "issue" || breakdownMode === "project") {
                    byId("searchInput").focus();
                }
                return;
            }
            if ((e.ctrlKey || e.metaKey) && e.key === "e") {
                e.preventDefault();
                if (!byId("exportBtn").disabled) exportExcel();
                return;
            }
            if ((e.ctrlKey || e.metaKey) && e.key === "c" && !window.getSelection().toString()) {
                e.preventDefault();
                if (!byId("copySummaryBtn").disabled) copySummary();
                return;
            }
            if ((e.ctrlKey || e.metaKey) && e.key === "d") {
                e.preventDefault();
                toggleTheme();
                return;
            }
            if ((e.ctrlKey || e.metaKey) && e.key === "w") {
                e.preventDefault();
                byId("widgetModal").classList.remove("hidden");
                return;
            }
            const numMap = { "1": 7, "2": 30, "3": "month", "4": "week", "5": "quarter", "6": "year" };
            if (numMap[e.key]) {
                const val = numMap[e.key];
                if (typeof val === "number") setPresetRange(val);
                else if (val === "month") setCurrentMonth();
                else if (val === "week") setThisWeek();
                else if (val === "quarter") setThisQuarter();
                else if (val === "year") setThisYear();
            }
        });
    }

    document.addEventListener("DOMContentLoaded", async function () {
        loadTheme();
        initIcons();
        await loadPlankaUsers();
        loadSavedValues();
        loadSavedRanges();
        loadWidgetVisibility();
        setPresetRange(7);
        attachEvents();
        setupKeyboardShortcuts();
        renderBreakdownMode();
    });
})();
