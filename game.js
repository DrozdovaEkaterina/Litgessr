(() => {
  "use strict";

  const rounds = window.LITGESSR_ROUNDS;
  const durations = {easy: 0, medium: 90, hard: 30};
  const dailyGoal = 5;
  const storageKey = "litgessr-progress-v1";
  const cycleKey = "litgessr-scene-cycle-v1";
  const $ = (id) => document.getElementById(id);
  const screens = [...document.querySelectorAll(".screen")];
  const authorInput = $("answer-author");
  const titleInput = $("answer-title");
  const timer = $("round-timer");
  const submit = $("submit-answer");
  const images = new Map();

  let canSave = true;
  let profile = {nickname: "", coins: 0, correct: 0, total: 0, days: {}};
  let mode = null;
  let seenScenes;
  let number = 0;
  let current = null;
  let screen = null;
  let timerId = null;
  let pendingRound = null;

  function readProfile() {
    try {
      const data = JSON.parse(localStorage.getItem(storageKey));
      if (data) profile = {...profile, ...data};
    } catch {
      // Keep the current profile when browser storage is unavailable.
    }
  }

  function saveProfile() {
    try {
      localStorage.setItem(storageKey, JSON.stringify(profile));
    } catch {
      canSave = false;
    }
  }

  function localDay(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function prettyDate(day) {
    return new Intl.DateTimeFormat("ru", {day: "numeric", month: "long", year: "numeric"})
      .format(new Date(`${day}T12:00:00`));
  }

  function formatNumber(number) {
    return number.toLocaleString("ru");
  }

  function dailyCount(day = localDay()) {
    return Math.min(profile.days[day]?.length || 0, dailyGoal);
  }

  function showScreen(name, focusId) {
    screen = name;
    document.body.dataset.screen = name;
    for (const section of screens) section.hidden = section.id !== name;
    $("shell").hidden = false;
    $("loading").hidden = true;
    const playing = name === "play";
    timer.hidden = !playing;
    $("game-round-number").hidden = !playing;
    $("open-progress").hidden = playing || name === "progress";
    $("footer").hidden = playing;
    document.querySelector(".brand").disabled = playing;
    window.scrollTo(0, 0);
    if (focusId) $(focusId).focus({preventScroll: true});
  }

  function showHome() {
    if (screen === "play") return;
    pendingRound = null;
    readProfile();
    const count = dailyCount();
    $("daily-home-count").textContent = `${count} из ${dailyGoal}`;
    $("daily-home-text").textContent = count === dailyGoal
      ? "Сегодняшняя победа уже в вашем дневнике."
      : "Угадайте 5 разных произведений, чтобы одержать победу дня.";
    updateBalance();
    showScreen("home", "home-title");
  }

  function updateBalance() {
    for (const value of document.querySelectorAll("[data-balance]")) {
      value.textContent = formatNumber(profile.coins);
    }
  }

  function showProgress() {
    readProfile();
    updateBalance();
    const count = dailyCount();
    $("nickname").value = profile.nickname;
    $("profile-note").textContent = canSave
      ? "Данные хранятся в этом браузере"
      : "Браузер ограничивает сохранение данных";
    $("stats-correct").textContent = formatNumber(profile.correct);
    $("stats-total").textContent = formatNumber(profile.total);
    $("stats-days").textContent = formatNumber(
      Object.values(profile.days).filter((ids) => ids.length >= dailyGoal).length
    );
    $("today-count").textContent = `${count} из ${dailyGoal}`;
    $("today-caption").textContent = count === dailyGoal
      ? "Победа дня получена"
      : "Угадано разных произведений";
    [...$("today-bar").children].forEach((part, index) => {
      part.classList.toggle("filled", index < count);
    });
    showScreen("progress", "progress-title");
  }

  function readSceneCycle() {
    try {
      const saved = JSON.parse(localStorage.getItem(cycleKey));
      if (Array.isArray(saved)) return saved;
    } catch {
      // Keep the current cycle when browser storage is unavailable.
    }
    return seenScenes ?? [...new Set(Object.values(profile.days).flat())];
  }

  function unseenRounds(seen) {
    const available = rounds.filter(({id}) => !seen.includes(id));
    return available.length ? available : rounds.filter(({id}) => id !== seen.at(-1));
  }

  function claimScene(round) {
    const seen = readSceneCycle();
    if (!unseenRounds(seen).includes(round)) return false;
    const completedCycle = rounds.every(({id}) => seen.includes(id));
    seenScenes = completedCycle ? [round.id] : [...seen, round.id];
    try {
      localStorage.setItem(cycleKey, JSON.stringify(seenScenes));
    } catch {
      // The current tab still keeps track of scenes.
    }
    return true;
  }

  function asset(id) {
    return `assets/${id}.jpg`;
  }

  function prepareImage(id) {
    if (images.has(id)) return images.get(id);
    const image = new Image();
    const loaded = new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error("Image could not be loaded"));
      image.src = asset(id);
    }).catch((error) => {
      images.delete(id);
      throw error;
    });
    images.set(id, loaded);
    return loaded;
  }

  function showLoading(message, failed = false) {
    screen = "loading";
    const overlay = $("loading");
    overlay.classList.toggle("load-error", failed);
    $("loading-message").textContent = message;
    $("retry").hidden = !failed;
    $("loading-back").hidden = !failed;
    $("shell").hidden = true;
    overlay.hidden = false;
    if (failed) $("retry").focus();
  }

  function startGame(nextMode) {
    if (screen !== "home") return;
    mode = nextMode;
    current = null;
    number = 0;
    nextRound();
  }

  function nextRound() {
    const available = unseenRounds(readSceneCycle());
    loadRound(available[Math.floor(Math.random() * available.length)]);
  }

  async function loadRound(round) {
    pendingRound = round;
    $("retry").disabled = true;
    showLoading("Готовим иллюстрацию…");
    try {
      await prepareImage(round.id);
    } catch {
      $("retry").disabled = false;
      showLoading("Не удалось загрузить иллюстрацию.", true);
      return;
    }

    const claimed = navigator.locks
      ? await navigator.locks.request(cycleKey, () => claimScene(round)).catch(() => claimScene(round))
      : claimScene(round);
    if (!claimed) {
      nextRound();
      return;
    }
    pendingRound = null;
    number++;
    $("scene-image").src = asset(round.id);
    $("game-round-number").textContent = `Раунд ${number}`;
    authorInput.value = "";
    titleInput.value = "";
    submit.disabled = true;
    updateBalance();
    timer.classList.remove("urgent");
    const duration = durations[mode];
    const started = performance.now();
    current = {round, started, deadline: duration ? started + duration * 1000 : Infinity};
    showScreen("play");
    if (matchMedia("(pointer: fine)").matches) authorInput.focus({preventScroll: true});
    updateTimer();
    if (duration && screen === "play") timerId = window.setInterval(updateTimer, 100);
  }

  function updateTimer() {
    if (screen !== "play") return;
    if (current.deadline === Infinity) {
      $("time-digits").textContent = "∞";
      timer.setAttribute("aria-label", "Без ограничения времени");
      return;
    }

    timer.setAttribute("aria-label", "Оставшееся время");
    const seconds = Math.ceil((current.deadline - performance.now()) / 1000);
    if (seconds <= 0) {
      finishRound(true);
      return;
    }
    const digits = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
    if ($("time-digits").textContent !== digits) $("time-digits").textContent = digits;
    timer.classList.toggle("urgent", seconds <= 10);
  }

  function normalize(value) {
    return value.normalize("NFKC").toLocaleLowerCase("ru").replace(/ё/g, "е")
      .replace(/[^а-я0-9]+/g, " ").trim();
  }

  function finishRound(timeExpired = false) {
    if (screen !== "play") return;
    const now = performance.now();
    const expired = timeExpired || now >= current.deadline;
    const authorAnswer = normalize(authorInput.value);
    const titleAnswer = normalize(titleInput.value);
    if (!expired && !authorAnswer && !titleAnswer) return;

    clearInterval(timerId);
    timerId = null;
    const {round, started} = current;
    const author = !expired && [round.author, ...round.authors].some(
      (name) => normalize(name) === authorAnswer
    );
    const title = !expired && [round.title, ...round.titles].some(
      (name) => normalize(name) === titleAnswer
    );
    const correct = author || title;
    const full = author && title;
    const base = correct ? (full ? 100 : 40) : 0;
    const bonusWindow = durations[mode] || 90;
    const bonus = correct ? Math.max(0, Math.round(50 * (1 - (now - started) / (bonusWindow * 1000)))) : 0;
    const total = base + bonus;

    readProfile();
    profile.total++;
    const day = localDay();
    const previous = profile.days[day] || [];
    if (correct) {
      profile.correct++;
      profile.coins += total;
      if (!previous.includes(round.id)) profile.days[day] = [...previous, round.id];
    }
    const count = dailyCount(day);
    const wonToday = previous.length < dailyGoal && count === dailyGoal;
    saveProfile();

    updateBalance();

    $("result-image").src = asset(round.id);
    $("result-title").textContent = correct ? "Раунд пройден" : expired ? "Время вышло" : "Раунд проигран";
    $("result-emblem").classList.toggle("loss", !correct);
    $("result-icon").setAttribute("href", correct ? "#i-check" : "#i-cross");
    $("result-book").textContent = round.title;
    $("result-author").textContent = round.author;
    $("result-scene").textContent = round.scene;
    $("round-coins").textContent = `+${total}`;
    $("round-coins-detail").hidden = !correct;
    if (correct) {
      $("round-base-label").textContent = full ? "За автора и название" : author ? "За автора" : "За название";
      $("round-base-coins").textContent = `+${base}`;
      $("round-speed-coins").textContent = `+${bonus}`;
    }
    $("result-daily").textContent = `${count} из ${dailyGoal}`;
    $("next-label").textContent = wonToday ? "К победе дня" : "Следующий раунд";
    const nextButton = $("next-round");
    nextButton.hidden = !correct;
    nextButton.disabled = !correct;
    nextButton.onclick = null;
    if (correct) nextButton.onclick = wonToday ? () => showVictory(day) : nextRound;
    $("result-home").classList.toggle("button-gold", !correct);
    $("result-home").classList.toggle("button-quiet", correct);
    showScreen("result", "result-title");
  }

  function showVictory(day) {
    $("victory-date").textContent = prettyDate(day);
    showScreen("victory", "victory-title");
  }

  for (const button of document.querySelectorAll("[data-mode]")) {
    button.addEventListener("click", () => startGame(button.dataset.mode));
  }
  for (const button of document.querySelectorAll("[data-home]")) {
    button.addEventListener("click", showHome);
  }
  $("loading-back").addEventListener("click", showHome);
  $("open-progress").addEventListener("click", showProgress);
  $("keep-playing").addEventListener("click", nextRound);
  $("retry").addEventListener("click", () => loadRound(pendingRound));
  submit.addEventListener("click", () => finishRound());
  for (const input of [authorInput, titleInput]) {
    input.addEventListener("input", () => {
      submit.disabled = !normalize(authorInput.value) && !normalize(titleInput.value);
    });
  }
  $("nickname").addEventListener("change", (event) => {
    readProfile();
    profile.nickname = event.target.value.trim();
    saveProfile();
    event.target.value = profile.nickname;
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) updateTimer();
  });
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) updateTimer();
  });
  window.addEventListener("storage", (event) => {
    if (event.key !== storageKey) return;
    if (screen === "home") showHome();
    else if (screen === "progress") showProgress();
    else {
      readProfile();
      updateBalance();
    }
  });

  readProfile();
  $("scene-count").textContent = `${rounds.length} сцен`;
  Promise.all([
    Promise.race([prepareImage("cover").catch(() => {}), new Promise((resolve) => setTimeout(resolve, 2500))]),
    new Promise((resolve) => setTimeout(resolve, 320))
  ]).then(showHome);
})();
