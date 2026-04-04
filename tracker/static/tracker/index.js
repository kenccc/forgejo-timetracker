(function () {
    const goalStorageKey = "forgejo-time-goal-hours";
    const rateStorageKey = "forgejo-hourly-rate";
    const userStorageKey = "forgejo-selected-user";
    let latestSummaryData = null;
    let latestSince = null;
    let latestBefore = null;
    let breakdownMode = "day";
    let forgejoUsers = [];

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

    function renderIssueBreakdown(rows) {
        const container = byId("issueBreakdown");
        container.innerHTML = "";
        if (!rows.length) {
            const row = document.createElement("div");
            row.className = "daily-row";
            row.innerHTML = '<span class="daily-date">No issue data in this range.</span>';
            container.appendChild(row);
            return;
        }
        rows.forEach((row) => {
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

    function renderBreakdownMode() {
        const isIssueMode = breakdownMode === "issue";
        byId("dailyBreakdown").classList.toggle("hidden", isIssueMode);
        byId("issueBreakdown").classList.toggle("hidden", !isIssueMode);
        byId("byDayBtn").classList.toggle("active", !isIssueMode);
        byId("byIssueBtn").classList.toggle("active", isIssueMode);
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
        renderDailyChart(data.daily_breakdown || []);
        renderDailyBreakdown(data.daily_breakdown || []);
        renderBreakdownMode();
        byId("result").classList.add("visible");
        byId("exportBtn").disabled = false;
        byId("copySummaryBtn").disabled = false;
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
            const query = new URLSearchParams({ since, before });
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
            byId("copySummaryBtn").disabled = true;
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
            Issue: row.issue,
            Hours: row.hours,
            Minutes: row.minutes,
            "Total (h:mm)": formatDuration(row.hours, row.minutes),
            "Total Seconds": row.total_seconds,
        }));
        if (issueRows.length) {
            const issueSheet = window.XLSX.utils.json_to_sheet(issueRows);
            window.XLSX.utils.book_append_sheet(wb, issueSheet, "By Issue");
        }
        const safeSince = (latestSince || "since").replaceAll("-", "");
        const safeBefore = (latestBefore || "before").replaceAll("-", "");
        window.XLSX.writeFile(wb, `time-summary-${safeSince}-${safeBefore}.xlsx`);
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
        } catch (_error) {
            showError("Clipboard access failed.");
        }
    }

    function persistInput(key, inputId) {
        const value = byId(inputId).value.trim();
        if (!value) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
    }

    async function loadForgejoUsers() {
        try {
            const res = await fetch("/api/users/");
            if (!res.ok) return;
            const data = await res.json();
            forgejoUsers = data.users || [];
            const select = byId("userSelect");
            forgejoUsers.forEach((user) => {
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

    function attachEvents() {
        byId("calcBtn").addEventListener("click", fetchTime);
        byId("exportBtn").addEventListener("click", exportExcel);
        byId("copySummaryBtn").addEventListener("click", copySummary);
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
        byId("userSelect").addEventListener("change", () => {
            persistInput(userStorageKey, "userSelect");
        });
        document.querySelectorAll(".quick-range-btn").forEach((button) => {
            button.addEventListener("click", () => {
                const range = button.dataset.range;
                if (range === "month") setCurrentMonth();
                else if (range === "week") setThisWeek();
                else setPresetRange(Number(range));
            });
        });
    }

    document.addEventListener("DOMContentLoaded", async function () {
        initIcons();
        await loadForgejoUsers();
        loadSavedValues();
        setPresetRange(7);
        attachEvents();
        renderBreakdownMode();
    });
})();
