function debounce(func, delay = 300) {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), delay);
  };
};

function getLocalDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
 
function dateStringToTimestamp(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day).getTime();
}

const storageKey = `syllabl_daily_${getLocalDateString()}`;

const state = {
  puzzle: null,
  currentStage: 0,
  score: 0,
  guesses: [],
  feedbackData: null,
  mode: null,
  hasFlippedPuzzleTitle: false,
  hasAnimatedFeedback: false,
};

let allEntries = [];

const feedbackEl = document.getElementById("feedback");

async function loadFeedback() {
  const res = await fetch('feedback.json');
  const data = await res.json();
  state.feedbackData = data;
}

async function loadPuzzles() {
  const res = await fetch('puzzles.json');
  const data = await res.json();
  state.puzzleData = data.puzzles;
}

async function selectDailyPuzzle() {
  const manualOverride = null; // example: "alt" or "ALT" - case-insensitive

  // Load the shuffled puzzle list
  const res = await fetch('shuffled_puzzles.json');
  const data = await res.json();
  const allPuzzles = data.puzzles;

  const todayStr = getLocalDateString(); // Local user time (YYYY-MM-DD)
  const today = dateStringToTimestamp(todayStr);

  // 1. Manual override
  if (manualOverride) {
    const match = allPuzzles.find(p => p.puzzleLetters.toLowerCase() === manualOverride.toLowerCase());
    if (match) {
      console.log(`🛠️ Manual override used: ${manualOverride}`);
      state.puzzle = match;
      return;
    } else {
      console.warn(`⚠️ Manual override '${manualOverride}' not found in shuffled list.`);
    }
  }

  // 2. Start from 2025-04-13 where 'dra' is Day 0 (index 0)
  const startDate = new Date('2025-04-13').getTime();
  const dayDiff = Math.floor((today - startDate) / (1000 * 60 * 60 * 24));
  const index = ((dayDiff % allPuzzles.length) + allPuzzles.length) % allPuzzles.length;

  state.puzzle = allPuzzles[index];
}

function selectRandomPuzzle() {
  const randomIndex = Math.floor(Math.random() * state.puzzleData.length);
  state.puzzle = state.puzzleData[randomIndex];
}

function validateGuess(guess) {
  const { puzzleLetters, inputsEnabled, syllablesRequired } = state.puzzle;
  const placementRule = inputsEnabled[state.currentStage];
  const syllableCount = syllablesRequired[state.currentStage];

  let isValidPlacement = false;

  switch (placementRule) {
    case 1:
      isValidPlacement = guess.endsWith(puzzleLetters);
      break;
    case 2:
      isValidPlacement = guess.startsWith(puzzleLetters);
      break;
    case 3:
      isValidPlacement =
        guess.includes(puzzleLetters) &&
        !guess.startsWith(puzzleLetters) &&
        !guess.endsWith(puzzleLetters);
      break;
    case 4:
      isValidPlacement =
        guess.startsWith(puzzleLetters) && guess.endsWith(puzzleLetters);
      break;
  }

  return { isValidPlacement, syllableCount };
}

async function checkSyllablesAndScoring(guess) {
  const apiUrl = `https://fr9m4nzsu1.execute-api.us-east-1.amazonaws.com/wordinfo?word=${encodeURIComponent(guess)}`;
  try {
    const res = await fetch(apiUrl, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });
    const data = await res.json();

    return {
      isValid: data.isValid,
      frequency: data.frequency,
      syllables: data.syllables,
      syllableList: data.syllableList,
      syllableParses: data.syllableParses,
      error: data.error
    };
  } catch (err) {
    return {
      isValid: false,
      frequency: 0,
      syllables: 0,
      syllableList: []
    };
  }
}

async function handleGuessSubmission(guess) {
  // ─── 1. Setup UI ─────────────────────────────
  const guessLog = document.getElementById('guessLog');
  const submitButton = document.getElementById('submitGuess');
  const guessInput = document.getElementById('guessInput');

  feedbackEl.innerHTML = `<em><span class="loading-dot">loading</span><span class="loading-dot">.</span><span class="loading-dot">.</span><span class="loading-dot">.</span></em>`;
  submitButton.disabled = true;
  guessInput.disabled = true;

  // ─── 2. Minimum length check ─────────────────
  if (guess.length < 4) {
    feedbackEl.innerHTML = `<strong class="highlight-rule">${guess.toLowerCase()}</strong> is too short. words must be at least 4 letters.`;
    const tip = createTooltip("your entry might be a valid word, but it's too short for this game. sorry!");
    feedbackEl.appendChild(tip);
    enableInput();
    return;
  }

  // ─── 3. Placement rule validation ────────────
  const { isValidPlacement, syllableCount } = validateGuess(guess);
  if (!isValidPlacement) {
    const rule = state.puzzle.inputsEnabled[state.currentStage];
    const ruleDescription = describeRule(rule);
    feedbackEl.innerHTML = `your word must <strong class="highlight-rule">${ruleDescription} ${state.puzzle.puzzleLetters.toLowerCase()}</strong>.`;

    const ruleTips = {
      1: "try placing the puzzle string at the end of your word. for example: 'earth' ends with 'rth'.",
      2: "try starting your word with the puzzle string. for example: 'earth' begins with 'ear'.",
      3: "the puzzle string should appear within the word, fully surrounded by letters. for example: 'earth' contains 'art'.",
      4: "try using the puzzle string at both the start and end of the word. it'll come to you eventually, maybe."
    };

    const tip = createTooltip(ruleTips[rule] || "Make sure the puzzle string is in the right spot.");
    feedbackEl.appendChild(tip);

    enableInput();
    return;
  }

  // ─── 4. Word validity and syllable count check ───
  const wordInfo = await checkSyllablesAndScoring(guess);
  if (!wordInfo.isValid) {
    feedbackEl.innerHTML = `<strong class="highlight-rule">${guess.toLowerCase()}</strong> is not a valid word.`;
    const tooltipMsg = wordInfo.error || "This word could not be validated.";
    feedbackEl.appendChild(createTooltip(tooltipMsg));
    enableInput();
    return;
  }

  const matchingParse = wordInfo.syllableParses?.find(p => p.count === syllableCount);
  if (!matchingParse) {
    const syllableText = syllableCount === 1 ? "syllable" : "syllables";
    feedbackEl.innerHTML = `your word must contain <strong class="highlight-rule">${syllableCount} ${syllableText}</strong>.`;

    const tooltip = createTooltip(
      `we asked for <strong>${syllableCount}</strong> ${syllableText}, and you gave a word with <strong>${wordInfo.syllables}</strong> (${wordInfo.syllableList.join("·")}).<br><br>` +
      `<em>do we have it wrong?</em> ` +
      `<a href="mailto:mario.d.gerardi@gmail.com?subject=Syllabl%20syllable%20mismatch"><strong>click here to report it!</strong></a>`
    );

    feedbackEl.appendChild(tooltip);
    enableInput();
    return;
  }

  // ─── 5. Scoring and guess recording ───────────
  const wordScore = determineScoreFromFrequency(wordInfo.frequency);
  state.guesses.push({
    word: guess,
    score: wordScore,
    syllables: matchingParse.count,
    frequency: wordInfo.frequency,
    syllableList: matchingParse.syllables
  });
  state.score += wordScore;

  // ─── 6. Animate syllables and give feedback ───
  displaySyllablesWithAnimation(matchingParse.syllables, async () => {
    if (state.currentStage < 6) {
      const feedbackCategory = determineFeedbackCategory(wordInfo.frequency);
      const scoreFeedback = getRandomFeedback(state.feedbackData.wordSubmissionFeedback[feedbackCategory]);
      feedbackEl.innerHTML = `${scoreFeedback}`;
    }

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const animatedBits = feedbackEl.querySelectorAll('.syllable, .interpunct');
        animatedBits.forEach((el, i) => {
          setTimeout(() => {
            el.classList.add('bounce');
            setTimeout(() => el.classList.remove('bounce'), 600);
          }, i * 100);
        });
      });
    });

    submitButton.disabled = false;
    guessInput.disabled = false;
    guessInput.focus();
  });

  // ─── 7. Display guess in UI ──────────────────
  const guessItem = document.createElement('div');
  guessItem.classList.add('guessItem', 'new');
  guessItem.innerHTML = `<span class="guessbox">${guess}</span>&nbsp;<span class="score">${wordScore}</span>`;
  guessItem.style.borderColor = getColorForScore(wordScore);
  guessItem.style.backgroundColor = getColorForScore(wordScore);
  guessLog.appendChild(guessItem);

  setTimeout(() => {
    guessItem.classList.remove('new');
  }, 400);

  // ─── 8. Save progress if in daily mode ────────
  state.currentStage++;
  if (state.mode === 'daily') {
    const todayKey = getLocalDateString();
    localStorage.setItem(`syllabl_daily_${todayKey}`, JSON.stringify({
      puzzleLetters: state.puzzle.puzzleLetters,
      currentStage: state.currentStage,
      guesses: state.guesses,
      score: state.score,
      puzzleDate: todayKey
    }));
  }

  // ─── 9. End game if needed ───────────────────
  if (state.currentStage >= 6) {
    displaySyllablesWithAnimation(matchingParse.syllables, () => {
      updateUI();
      endGame();
    });
  }

  // ─── 10. Prepare for next input if not complete ──
  else {
    updateUI();
    submitButton.disabled = false;
    guessInput.disabled = false;
    guessInput.focus();
  }
}

function displaySyllablesWithAnimation(syllables, callback) {
  feedbackEl.innerHTML = '';
  const syllableContainer = document.createElement('div');
  syllableContainer.id = 'syllableAnimation';
  syllableContainer.style.display = 'inline-block';

  syllables.forEach((syllable, index) => {
    const span = document.createElement('span');
    span.classList.add('syllable');
    span.innerHTML = syllable;
    span.style.opacity = '0';
    syllableContainer.appendChild(span);

    if (index < syllables.length - 1) {
      const interpunct = document.createElement('span');
      interpunct.classList.add('interpunct');
      interpunct.innerHTML = '·';
      interpunct.style.opacity = '0';
      syllableContainer.appendChild(interpunct);
    }
  });

  feedbackEl.appendChild(syllableContainer);

  const elements = syllableContainer.children;
  const delay = 300;
  const totalTime = elements.length * delay + 800;

  Array.from(elements).forEach((el, i) => {
    setTimeout(() => {
      el.style.opacity = '1';
      el.classList.add('bounce');
    }, i * delay);
  });

  setTimeout(callback, totalTime);
}

function endGame() {
  // Prevent double-counting stats
  const todayKey = getLocalDateString();
  const gameId = `${state.mode}_${state.puzzle?.puzzleLetters || 'unknown'}_${todayKey}`;
  const alreadyProcessed = localStorage.getItem(`gameStatsProcessed_${gameId}`);
  if (!alreadyProcessed) {
    localStorage.setItem(`gameStatsProcessed_${gameId}`, 'true');

    // Save best score for non-custom puzzles
    if (state.puzzle && !state.puzzle.isCustom) {
      const key = `bestScore_${state.puzzle.puzzleLetters}`;
      const previous = parseFloat(localStorage.getItem(key));
      const current = state.score;
    if (isNaN(previous) || current > previous) {
      localStorage.setItem(key, current);
    }
    }

    // --- Save statistics ---
    const totalGames = parseInt(localStorage.getItem('gamesCompleted') || '0') + 1;
    localStorage.setItem('gamesCompleted', totalGames);

    const totalValidWords = parseInt(localStorage.getItem('totalValidWords') || '0') + state.guesses.length;
    localStorage.setItem('totalValidWords', totalValidWords);

    const totalSyllables = parseInt(localStorage.getItem('totalSyllableCount') || '0') +
      state.guesses.reduce((sum, guess) => sum + guess.syllables, 0);
    localStorage.setItem('totalSyllableCount', totalSyllables);

    const totalScore = parseFloat(localStorage.getItem('totalScore') || '0') + state.score;
    localStorage.setItem('totalScore', totalScore);

    // Check and store longest valid word
    const longestSoFar = localStorage.getItem('longestWord') || '';
    const longestNow = state.guesses.reduce((longest, current) => {
      return current.word.length > longest.length ? current.word : longest;
    }, longestSoFar);

    if (longestNow.length > longestSoFar.length) {
      localStorage.setItem('longestWord', longestNow);
    }

    // Check and store rarest word
    const rarestSoFar = JSON.parse(localStorage.getItem('rarestWord') || '{}'); // { word, frequency }
    const rarestNow = state.guesses.reduce((rarest, current) => {
      if (!rarest.word || current.frequency < rarest.frequency) {
        return { word: current.word, frequency: current.frequency };
      }
      return rarest;
    }, rarestSoFar);

    if (!rarestSoFar.word || rarestNow.frequency < rarestSoFar.frequency) {
      localStorage.setItem('rarestWord', JSON.stringify(rarestNow));
    }

    // Check and store longest syllable
    const previousLongestSyllable = JSON.parse(localStorage.getItem('longestSyllable') || '{}'); // { syllable, word, display }

    state.guesses.forEach(({ word, syllableList }) => {
      syllableList.forEach((syl) => {
        if (!previousLongestSyllable.syllable || syl.length > previousLongestSyllable.syllable.length) {
          const display = syllableList.map(s => s === syl ? `<strong>${s}</strong>` : s).join('·');
          localStorage.setItem('longestSyllable', JSON.stringify({ syllable: syl, word, display }));
        }
      });
    });

    // Track most common syllable
    const syllableCounts = JSON.parse(localStorage.getItem('syllableCounts') || '{}');

    state.guesses.forEach(({ syllableList }) => {
      syllableList.forEach(syl => {
        syllableCounts[syl] = (syllableCounts[syl] || 0) + 1;
      });
    });

    localStorage.setItem('syllableCounts', JSON.stringify(syllableCounts));

    let mostCommon = { syllable: null, count: 0 };
    for (const [syl, count] of Object.entries(syllableCounts)) {
      if (count > mostCommon.count) {
        mostCommon = { syllable: syl, count };
      }
    }
    localStorage.setItem('mostCommonSyllable', JSON.stringify(mostCommon));

    if (state.mode === 'daily') {
      // Keep final game state stored
      localStorage.setItem(`syllabl_daily_${todayKey}`, JSON.stringify({
        puzzleLetters: state.puzzle.puzzleLetters,
        currentStage: state.currentStage,
        guesses: state.guesses,
        score: state.score,
        puzzleDate: todayKey
      }));

      // Submit data to backend for "How Did You Do?" leaderboard tracking
      submitDailyPerformance();
    }

  } // end if(!alreadyProcessed)

  const guessInput = document.getElementById('guessInput');
  const submitButton = document.getElementById('submitGuess');
  if (guessInput && submitButton) {
    guessInput.disabled = true;
    submitButton.disabled = true;
    guessInput.placeholder = "thanks for playing!";
  }
}

function createPuzzleTitle(puzzleLetters) {
  const puzzleTitle = document.createElement('div');
  puzzleTitle.className = 'puzzle-title';
  puzzleTitle.innerHTML = `<span class="puzzle-header">puzzle string:</span><strong class="puzzle-letters">${puzzleLetters.toLowerCase()}</strong>`;

  if (!state.hasFlippedPuzzleTitle) {
    puzzleTitle.classList.add('flip-once');
    state.hasFlippedPuzzleTitle = true;
    setTimeout(() => puzzleTitle.classList.remove('flip-once'), 1000);
  }

  return puzzleTitle;
}

function updateUI() {
  // ─── DOM Elements ─────────────────────────────────
  const puzzleInfoEl = document.getElementById('puzzleInfo');
  const inputContainer = document.getElementById('input-container');
  const progressBar = document.getElementById('progressBar');
  const gameSection = document.getElementById('game');

  // ─── Game State ──────────────────────────────────
  const { puzzleLetters, inputsEnabled, syllablesRequired } = state.puzzle;
  const totalStages = 6;
  const currentStage = state.currentStage;

  // ─── Progress Bar Update ─────────────────────────
  if (progressBar) {
    const progressPercentage = (currentStage / totalStages) * 100;
    const shouldAnimateFromZero = gameSection?.classList.contains('fresh-load');

    if (shouldAnimateFromZero) {
      progressBar.style.transition = 'none';
      progressBar.style.width = '0%';
      void progressBar.offsetWidth;
      progressBar.style.transition = 'width 0.5s ease-in-out';
      setTimeout(() => {
        progressBar.style.width = `${progressPercentage}%`;
        gameSection.classList.remove('fresh-load');
      }, 50);
    } else {
      progressBar.style.transition = 'width 0.5s ease-in-out';
      progressBar.style.width = `${progressPercentage}%`;
    }
  }

  // ─── Clear Existing Prompt ───────────────────────
  const existingPrompt = document.querySelector('.puzzle-prompt');
  if (existingPrompt) existingPrompt.remove();

  // ─── Game Completion UI ──────────────────────────
  if (currentStage >= totalStages) {
    const puzzleTitle = createPuzzleTitle(puzzleLetters);
    puzzleInfoEl.innerHTML = '';
    puzzleInfoEl.appendChild(puzzleTitle);

    const scoreCategory = determineVictoryFeedbackCategory(state.score);
    const feedbackMessages = state.feedbackData?.victoryFeedback?.[scoreCategory] ?? [];
    const finalFeedback = getRandomFeedback(feedbackMessages);
    feedbackEl.innerHTML = finalFeedback;

    const puzzlePrompt = document.getElementById('puzzle-prompt') || document.createElement('div');
    puzzlePrompt.className = 'puzzle-prompt flip-in';
    puzzlePrompt.id = 'puzzle-prompt';
    setTimeout(() => puzzlePrompt.classList.remove('flip-in'), 600);

    if (state.mode === 'daily') {
      const howDidYouDoBtn = document.createElement('button');
      howDidYouDoBtn.className = 'howdyado-button';
      howDidYouDoBtn.id = 'howDidYouDoButtonGame';
      howDidYouDoBtn.innerHTML = `<span class="syllable">let's</span> <span class="syllable">see</span> <span class="syllable">how</span> <span class="syllable">you</span> <span class="syllable">did</span> <span class="syllable">→</span>`;
      howDidYouDoBtn.addEventListener('click', async () => {
        if (howDidYouDoBtn.disabled) return;
        howDidYouDoBtn.disabled = true;
        await showHowDidYouDo?.(howDidYouDoBtn.id);
        setTimeout(() => {
          hideAllScreensExcept("howDidYouDoSection");
        }, 400);
      });
    puzzlePrompt.appendChild(howDidYouDoBtn);
    howDidYouDoBtn.disabled = false;
    puzzlePrompt.style.paddingTop = '8px';
    puzzlePrompt.style.paddingBottom = '8px';
    } else {
      puzzlePrompt.innerHTML = `your final score: <strong>${state.score}</strong>`;
    }

    inputContainer.parentNode.insertBefore(feedbackEl, inputContainer.nextSibling);
    inputContainer.parentNode.insertBefore(puzzlePrompt, inputContainer);
  }

  // ─── In-Progress Puzzle UI ───────────────────────
  else {
    const puzzleTitle = createPuzzleTitle(puzzleLetters);
    puzzleInfoEl.innerHTML = '';
    puzzleInfoEl.appendChild(puzzleTitle);

    const ruleCode = inputsEnabled[currentStage];
    const ruleDescription = describeRule(ruleCode);
    const sylCount = syllablesRequired[currentStage];

    const puzzlePrompt = document.createElement('div');
    puzzlePrompt.className = 'puzzle-prompt flip-in';
    puzzlePrompt.id = 'puzzle-prompt';
    setTimeout(() => puzzlePrompt.classList.remove('flip-in'), 600);

    puzzlePrompt.innerHTML = `your word must <strong>${ruleDescription} ${puzzleLetters.toLowerCase()}</strong> and contain <strong>${sylCount}</strong> ${sylCount === 1 ? "syllable" : "syllables"}.`;

    inputContainer.parentNode.insertBefore(feedbackEl, inputContainer.nextSibling);
    inputContainer.parentNode.insertBefore(puzzlePrompt, inputContainer);
  }
}

function describeRule(ruleCode) {
  switch (ruleCode) {
    case 1: return 'end with';
    case 2: return 'begin with';
    case 3: return 'fully contain';
    case 4: return 'begin and end with';
    default: return 'follow an unknown rule';
  }
}

function getRandomFeedback(feedbackArray) {
  return feedbackArray[Math.floor(Math.random() * feedbackArray.length)];
}

function determineVictoryFeedbackCategory(score) {
  if (score <= 10) return "10orLower";
  if (score <= 15) return "15orLower";
  if (score <= 20) return "20orLower";
  if (score <= 25) return "25orLower";
  return "30orLower";
}

function determineScoreFromFrequency(frequency) {
  if (frequency >= 100) return 1;
  if (frequency >= 10) return 2;
  if (frequency >= 1) return 3;
  if (frequency >= 0.1) return 4;
  return 5;
}

function determineFeedbackCategory(frequency) {
  if (frequency >= 100) return "1";
  if (frequency >= 10) return "2";
  if (frequency >= 1) return "3";
  if (frequency >= 0.1) return "4";
  return "5";
}

function getColorForScore(score) {
  switch (score) {
    case 1: return "var(--verycommon-word)";
    case 2: return "var(--common-word)";
    case 3: return "var(--uncommon-word)";
    case 4: return "var(--rare-word)";
    case 5: return "var(--ultrarare-word)";
    default: return "var(--common-word)";
  }
}

function enableInput() {
  const guessInput = document.getElementById('guessInput');
  const submitButton = document.getElementById('submitGuess');
  submitButton.disabled = false;
  guessInput.disabled = false;
  guessInput.focus();
}

async function initGame(puzzleSelector = selectDailyPuzzle) {
  // 1. Handle mode and reset state
  if (state.mode !== 'daily') {
    resetPuzzleStateAndUI();
  }

  // 2. Load saved daily progress
  if (state.mode === 'daily') {
    const todayKey = getLocalDateString();
    const saved = localStorage.getItem(`syllabl_daily_${todayKey}`);
    if (saved) {
      const parsed = JSON.parse(saved);
      state.currentStage = parsed.currentStage;
      state.guesses = parsed.guesses;
      state.score = parsed.score;
    }
  }

  // 3. Fallback to daily mode if not set
  if (!state.mode) {
    state.mode = 'daily';
  }

  // 4. Load feedback and puzzle data
  await loadFeedback(); 
  console.log("Loaded feedback data:", state.feedbackData);

  await loadPuzzles();

  // 5. Select puzzle (daily/shuffle/custom)
  puzzleSelector(); 

  // 6. Render UI based on loaded state
  updateUI(); 
  renderPreviousGuesses();

  // 7. Finalize: end game or resume input
  if (state.mode && state.currentStage >= 6) {
    endGame();
  } else {
    enableInput();
  }

  // 8. Show greeting and focus input
  displayGreetingMessage();

  document.getElementById('guessInput').focus();
}

function renderPreviousGuesses() {
  const guessLog = document.getElementById('guessLog');
  guessLog.innerHTML = ''; // clear it first

  state.guesses.forEach(g => {
    const guessItem = document.createElement('div');
    guessItem.classList.add('guessItem');
    guessItem.innerHTML = `<span class="guessbox">${g.word}</span>&nbsp;<span class="score">${g.score}</span>`;
    guessItem.style.borderColor = getColorForScore(g.score);
    guessItem.style.backgroundColor = getColorForScore(g.score);
    guessLog.appendChild(guessItem);
  });
}

function displayGreetingMessage() {
  if (!state.feedbackData || !state.feedbackData.greetings) return;

  const greetings = state.feedbackData.greetings;
  const {
    newDailyPuzzle,
    resumedDailyPuzzle,
    completedDailyPuzzle,
    customPuzzleStart,
    shufflePuzzleStart
  } = greetings;

  let greetingMessage = '';
  const stage = state.currentStage;
  const isComplete = stage >= 6;

  switch (state.mode) {
    case 'daily':
      if (isComplete) {
        greetingMessage = getRandomFeedback(completedDailyPuzzle);
      } else if (stage > 0) {
        greetingMessage = getRandomFeedback(resumedDailyPuzzle);
      } else {
        greetingMessage = getRandomFeedback(newDailyPuzzle);
      }
      break;
    case 'custom':
      greetingMessage = getRandomFeedback(customPuzzleStart);
      break;
    case 'shuffle':
      greetingMessage = getRandomFeedback(shufflePuzzleStart || ["ready to shuffle?"]);
      break;
    default:
      greetingMessage = getRandomFeedback(newDailyPuzzle);
      break;
  }

  // Apply message to DOM
  feedbackEl.innerHTML = greetingMessage;
  if (!state.hasAnimatedFeedback) {
    feedbackEl.classList.add('animate-once');
    state.hasAnimatedFeedback = true;
  }

  // Delay bounce until slide-in finishes (slide-in is 0.6s long)
  const totalDelay = 600;

  setTimeout(() => {
    const bits = feedbackEl.querySelectorAll('.syllable, .interpunct');
    bits.forEach((el) => {
      el.classList.remove('bounce'); // Reset any leftover animation
      void el.offsetWidth;           // Force reflow
    });

    bits.forEach((el, i) => {
      setTimeout(() => {
        el.classList.add('bounce');
        setTimeout(() => el.classList.remove('bounce'), 600); // Match bounce duration
      }, i * 100); // Stagger each element's start
    });
  }, totalDelay);
}

function resetPuzzleStateAndUI() {
  state.currentStage = 0;
  state.score = 0;
  state.guesses = [];

  const guessLog = document.getElementById('guessLog');
  if (guessLog) guessLog.innerHTML = '';

  feedbackEl.innerHTML = '';
  const guessInput = document.getElementById('guessInput');
  if (guessInput) guessInput.placeholder = "enter your word...";
  enableInput();
}

async function startNewPuzzle(mode, puzzle, puzzleSelector = null) {
  // 1. Set game mode and reset state
  state.mode = mode;
  resetPuzzleStateAndUI();

  // 2. Load feedback (always needed)
  await loadFeedback();
  // 3. Load puzzles (only for non-custom/daily)
  if (mode !== 'custom' && mode !== 'daily') {
    await loadPuzzles();
  }

  // 4. Daily mode logic and resume if needed
  if (mode === 'daily') {
    if (state.mode === 'daily') {
      const todayKey = getLocalDateString();
      const saved = localStorage.getItem(`syllabl_daily_${todayKey}`);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.puzzleDate === todayKey) {
          state.currentStage = parsed.currentStage;
          state.guesses = parsed.guesses;
          state.score = parsed.score;
          if (parsed.currentStage >= 6) {
            const guessInput = document.getElementById('guessInput');
            const submitButton = document.getElementById('submitGuess');
            if (guessInput && submitButton) {
              guessInput.disabled = true;
              guessInput.blur();
              submitButton.disabled = true;
              guessInput.placeholder = "thanks for playing!";
            }
          }
        } else {
          localStorage.removeItem(`syllabl_daily_${todayKey}`);
        }
      }
    }
    await loadPuzzles();
    if (puzzleSelector) await puzzleSelector();
  } else {
    // 5. Set puzzle for other modes
    if (puzzleSelector) {
      puzzleSelector();
    } else {
      state.puzzle = puzzle;
    }
  }

  // 6. Transition to game screen
  hideAllScreensExcept('game');
  animateGameEntry();

  // 7. Safety check for puzzle existence
  if (!state.puzzle) {
    console.error("Puzzle not set before calling updateUI()");
    return;
  }

  // 8. Render UI and handle completed games
  updateUI();
  renderPreviousGuesses();
  if (state.currentStage >= 6) {
    endGame();
  } else {
    enableInput();
  }

  // 9. Show greeting and focus input
  displayGreetingMessage();
  document.getElementById('guessInput').focus();
}

function hideAllScreensExcept(idToShow) {
  const screens = [
    'homeScreen',
    'createPuzzleSection',
    'allPuzzlesSection',
    'howToPlaySection',
    'statisticsSection',
    'themesSection',
    'aboutSection',
    'game',
    'howDidYouDoSection'
  ];

  const target = document.getElementById(idToShow);
  if (target?.classList.contains("info-section")) {
    target.classList.add("flip-in");
    setTimeout(() => target.classList.remove("flip-in"), 700); // remove after animation
  }

  screens.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;

    const isGame = id === 'game' || id === 'homeScreen';
    el.style.display = (id === idToShow) ? (isGame ? 'flex' : 'block') : 'none';
    if (id === 'game' && id === idToShow) {
      el.classList.add('fresh-load');
    }
    if (id !== idToShow) {
      el.classList.add('fade-out-down');
      setTimeout(() => {
        el.classList.add('hidden');
        el.classList.remove('fade-out-down');
      }, 300); // Match duration of fadeOutDown
    } else {
      el.classList.remove('hidden');
    }
  });
}

function setupPuzzleButtons() {
  const howToPlayButton = document.getElementById('howToPlayButton');
  const themesButton = document.getElementById('themesButton');
  const statisticsButton = document.getElementById('statisticsButton');
  const aboutButton = document.getElementById('aboutButton');
  const createPuzzleButton = document.getElementById('createPuzzleButton');
  const allPuzzlesButton = document.getElementById('allPuzzlesButton');
  const dailyButton = document.getElementById('dailyPuzzleButton');
  const shuffleButton = document.getElementById('shuffleButton');

  if (howToPlayButton) {
    howToPlayButton.addEventListener('click', async () => {
      await animateHomeExit();
      hideAllScreensExcept('howToPlaySection');
    });
  }

  if (aboutButton) {
    aboutButton.addEventListener('click', async () => {
      await animateHomeExit();
      hideAllScreensExcept('aboutSection');
    });
  }

  if (themesButton) {
    themesButton.addEventListener('click', async () => {
      await animateHomeExit();
      hideAllScreensExcept('themesSection');
    });
  }

  if (statisticsButton) {
    statisticsButton.addEventListener('click', async () => {
      await animateHomeExit();
      renderStatistics();
      hideAllScreensExcept('statisticsSection');
    });
  }

  if (createPuzzleButton) {
    createPuzzleButton.addEventListener('click', async () => {
      if (window.innerWidth < 1150) {
        alert("The puzzle creator works best on wider screens. Please use a device with a larger display.");
        return;
      }
      await animateHomeExit();
      hideAllScreensExcept('createPuzzleSection');
      renderCreatePuzzleRows();
    });
  }

  if (allPuzzlesButton) {
    allPuzzlesButton.addEventListener('click', async () => {
      await animateHomeExit();
      await loadPuzzles();
      renderAllPuzzles();
      hideAllScreensExcept('allPuzzlesSection');

      const sortDropdown = document.getElementById('sortPuzzles');
      if (sortDropdown) {
        sortDropdown.addEventListener('change', () => {
          renderAllPuzzles();
        });
      }
    });
  }

  if (dailyButton) {
    dailyButton.addEventListener('click', async () => {
      await animateHomeExit();
      await startNewPuzzle('daily', null, selectDailyPuzzle);
    });
  }

  if (shuffleButton) {
    shuffleButton.addEventListener('click', async () => {
      await animateHomeExit();
      await startNewPuzzle('shuffle', null, selectRandomPuzzle);
    });
  }

  // Back to Home buttons
  [
    'backToHomeFromThemes',
    'backToHomeFromCreate',
    'backToHomeFromAllPuzzles',
    'backToHomeFromStatistics',
    'backToHomeFromAbout',
    'backToHomeFromGame',
    'backToHomeFromHowToPlay'
  ].forEach(id => {
    const el = document.getElementById(id); // ✅ FIX: define el

    if (!el) return;

    if (id === 'backToHomeFromGame') {
      el.addEventListener('click', () => {
        state.hasFlippedPuzzleTitle = false; // ✅ Reset the flip state
        hideAllScreensExcept('homeScreen');
        resetHomeAnimations();
      });
    } else {
      el.addEventListener('click', () => {
        hideAllScreensExcept('homeScreen');
        resetHomeAnimations();
      });
    }
  });
}

document.querySelectorAll('.theme-button').forEach(btn => {
  btn.addEventListener('click', () => {
    const selectedTheme = btn.dataset.theme;
    if (!btn.classList.contains('locked') && selectedTheme) {
      document.documentElement.setAttribute('data-theme', selectedTheme);
      localStorage.setItem('preferredTheme', selectedTheme);
      document.querySelectorAll('.theme-button').forEach(b => b.classList.remove('current-theme'));
      btn.classList.add('current-theme');
    }
  });
});

document.getElementById('submitGuess').addEventListener('click', async () => {
  const guessInput = document.getElementById('guessInput');
  const guess = guessInput.value.trim().toLowerCase();
  if (guess) {
    await handleGuessSubmission(guess);
    guessInput.value = '';
  }
});

// Restrict input to letters only as user types
document.getElementById('guessInput').addEventListener('input', (e) => {
  e.target.value = e.target.value.replace(/[^a-zA-Z]/g, '');
});

// Function to render the word cloud with words grouped by frequency
function renderWordCloud(words) {
  if (!Array.isArray(words) || words.length === 0) {
    console.warn('Word cloud skipped: no words provided');
    return;
  }
  
  const wordCounts = {};
  words.forEach(word => {
    if (!word) return;
    wordCounts[word] = (wordCounts[word] || 0) + 1;
  });
  
  const container = document.getElementById('wordCloudContainer');
  container.innerHTML = '';
  
  const groups = {};
  for (const [word, count] of Object.entries(wordCounts)) {
    if (!groups[count]) groups[count] = [];
    groups[count].push(word);
  }
  
  const sortedFrequencies = Object.keys(groups).map(Number).sort((a, b) => b - a);
  
  sortedFrequencies.forEach(freq => {
    const row = document.createElement('div');
    row.className = 'cloudRow';
  
    const inner = document.createElement('div');
    inner.className = 'cloudInnerRow';
  
    groups[freq].forEach(word => {
      const div = document.createElement('div');
      div.className = 'cloudWord guessItem';
      div.textContent = word;
      div.style.fontSize = `${8 + Math.pow(freq, 1.5) * 2}px`;
  
      // Assign background color by row index
      switch (sortedFrequencies.indexOf(freq)) {
        case 0:
          div.style.backgroundColor = 'var(--ultrarare-word)';
          break;
        case 1:
          div.style.backgroundColor = 'var(--rare-word)';
          break;
        case 2:
          div.style.backgroundColor = 'var(--uncommon-word)';
          break;
        case 3:
          div.style.backgroundColor = 'var(--common-word)';
          break;
        default:
          div.style.backgroundColor = 'var(--verycommon-word)';
      }
  
      inner.appendChild(div);
    });
  
    row.appendChild(inner);
    container.appendChild(row);
  });
}

// Handle guess submission on Enter
document.getElementById('guessInput').addEventListener('keydown', async (event) => {
  const guessInput = document.getElementById('guessInput');
  if (event.key === 'Enter') {
    if (guessInput.disabled) return;
    event.preventDefault();
    const guess = guessInput.value.trim().toLowerCase();
    if (guess) {
      await handleGuessSubmission(guess);
      guessInput.value = '';
    }
  }
});

document.addEventListener('click', function (e) {
  const isTooltipIcon = e.target.classList.contains('tooltip-icon');
  document.querySelectorAll('.tooltip-container').forEach(container => {
    if (container.contains(e.target) && isTooltipIcon) {
      container.classList.toggle('active');
    } else {
      container.classList.remove('active');
    }
  });
});

function createTooltip(message) {
  const container = document.createElement('div');
  container.className = 'tooltip-container';

  const icon = document.createElement('span');
  icon.className = 'tooltip-icon';
  icon.textContent = '?';

  const box = document.createElement('div');
  box.className = 'tooltip-box';
  box.innerHTML = message;

  container.appendChild(icon);
  container.appendChild(box);
  return container;
}

function renderCreatePuzzleRows() {
  const container = document.getElementById('createRows');
  container.innerHTML = '';

  const placementOptions = [
    { value: 1, label: 'end with' },
    { value: 2, label: 'begin with' },
    { value: 3, label: 'fully contain' },
    { value: 4, label: 'begin and end with' }
  ];

  for (let i = 0; i < 6; i++) {
    const row = document.createElement('div');
    row.className = 'create-row';
    row.innerHTML = `
      <span class="stage-label highlight-rule">level ${i + 1}:</span>
      your word must 
      <select class="placement-select">
        ${placementOptions.map(opt => `<option value="${opt.value}">${opt.label}</option>`).join('')}
      </select>
      <span class="connector-text">the letters</span>
      <strong class="live-string">???</strong>
      and contain 
      <select class="syllable-select">
        ${[1, 2, 3, 4, 5, 6].map(n => `<option value="${n}">${n} syllable${n > 1 ? 's' : ''}</option>`).join('')}
      </select>·
      <input type="text" class="word-input" placeholder="enter a word..."/>
      <span class="word-validation-message">enter a word to validate.</span>
    `;
    container.appendChild(row);
  }

  const puzzleLettersInput = document.getElementById('puzzleLetters');

  if (!puzzleLettersInput) {
    console.warn('puzzleLetters input not found — skipping event binding.');
    return;
  }

  puzzleLettersInput.addEventListener('input', () => {
    const value = puzzleLettersInput.value.toLowerCase().trim() || '???';
    document.querySelectorAll('.live-string').forEach(span => {
      span.textContent = value;
    });
    container.querySelectorAll('.word-validation-message').forEach(msg => {
      msg.textContent = 'enter a word to validate.';
    });
  });

  function validateRow(index) {
    const puzzleLetters = puzzleLettersInput.value.toLowerCase().trim();
    const ruleSelect = container.querySelectorAll('.placement-select')[index];
    const syllableSelect = container.querySelectorAll('.syllable-select')[index];
    const wordInput = container.querySelectorAll('.word-input')[index];
    const messageEl = container.querySelectorAll('.word-validation-message')[index];
    const word = wordInput.value.trim().toLowerCase();

    if (!puzzleLetters || puzzleLetters.length !== 3 || !word || !ruleSelect.value || !syllableSelect.value) {
      messageEl.textContent = '';
      return;
    }

    if (word.length < 3) {
      messageEl.textContent = `❌ word must be at least 3 letters`;
      messageEl.style.color = 'crimson';
      return;
    }

    const ruleCode = parseInt(ruleSelect.value);
    let passesRule = false;
    switch (ruleCode) {
      case 1: passesRule = word.endsWith(puzzleLetters); break;
      case 2: passesRule = word.startsWith(puzzleLetters); break;
      case 3: passesRule = word.includes(puzzleLetters) && !word.startsWith(puzzleLetters) && !word.endsWith(puzzleLetters); break;
      case 4: passesRule = word.startsWith(puzzleLetters) && word.endsWith(puzzleLetters); break;
    }

    if (!passesRule) {
      messageEl.textContent = `❌ does not ${ruleSelect.options[ruleSelect.selectedIndex].text} "${puzzleLetters}"`;
      messageEl.style.color = 'crimson';
      return;
    }

    const requiredSyllables = parseInt(syllableSelect.value);
    checkSyllablesAndScoring(word).then(wordInfo => {
      if (!wordInfo.isValid) {
        messageEl.textContent = `❌ not a valid word`;
        messageEl.style.color = 'crimson';
        return;
      }

      const matchingParse = wordInfo.syllableParses?.find(p => p.count === requiredSyllables);
      if (!matchingParse) {
        messageEl.textContent = `❌ has ${wordInfo.syllables} syllable${wordInfo.syllables > 1 ? 's' : ''}, not ${requiredSyllables}`;
        messageEl.style.color = 'crimson';
        return;
      }

      messageEl.textContent = `✅ valid`;
      messageEl.style.color = 'green';
    });
  }

  container.querySelectorAll('.create-row').forEach((row, index) => {
    row.querySelector('.word-input').addEventListener('input', debounce(() => validateRow(index)));
    row.querySelectorAll('select').forEach(select => {
      select.addEventListener('change', () => validateRow(index));
    });
  });
}

async function validateAllRowsAndBuildPuzzle(puzzleLettersInput, container) {
  const puzzleLetters = puzzleLettersInput.value.toLowerCase().trim();
  if (puzzleLetters.length !== 3) {
    alert("Please enter a valid 3-letter string.");
    return null;
  }

  const rows = container.querySelectorAll('.create-row');
  const seenCombos = new Set();
  const inputsEnabled = [];
  const syllablesRequired = [];
  const validWords = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const ruleSelect = row.querySelector('.placement-select');
    const syllableSelect = row.querySelector('.syllable-select');
    const wordInput = row.querySelector('.word-input');
    const word = wordInput.value.trim().toLowerCase();
    const rule = parseInt(ruleSelect.value);
    const syllables = parseInt(syllableSelect.value);
    const comboKey = `${rule}-${syllables}`;
    if (seenCombos.has(comboKey)) {
      alert(`Duplicate rule and syllable count found at stage ${i + 1}. Each stage must be unique.`);
      return null;
    }
    seenCombos.add(comboKey);

    if (!word || word.length < 3) {
      alert(`Stage ${i + 1}: Word is too short.`);
      return null;
    }

    let passesRule = false;
    switch (rule) {
      case 1: passesRule = word.endsWith(puzzleLetters); break;
      case 2: passesRule = word.startsWith(puzzleLetters); break;
      case 3: passesRule = word.includes(puzzleLetters) && !word.startsWith(puzzleLetters) && !word.endsWith(puzzleLetters); break;
      case 4: passesRule = word.startsWith(puzzleLetters) && word.endsWith(puzzleLetters); break;
    }

    if (!passesRule) {
      alert(`Stage ${i + 1}: Word does not ${ruleSelect.options[ruleSelect.selectedIndex].text} "${puzzleLetters}".`);
      return null;
    }

    const wordInfo = await checkSyllablesAndScoring(word);
    if (!wordInfo.isValid) {
      alert(`Stage ${i + 1}: "${word}" is not a valid word.`);
      return null;
    }

    if (wordInfo.syllables !== syllables) {
      alert(`Stage ${i + 1}: "${word}" has ${wordInfo.syllables} syllables, not ${syllables}.`);
      return null;
    }

    inputsEnabled.push(rule);
    syllablesRequired.push(syllables);
    validWords.push(word);
  }

  return { puzzleLetters, inputsEnabled, syllablesRequired, validWords };
}

function renderAllPuzzles() {
  const puzzleList = document.getElementById('puzzleList');
  const sortSelect = document.getElementById('sortPuzzles');
  puzzleList.innerHTML = '';

  // Copy array to avoid mutating original
  const puzzles = [...state.puzzleData];

  // Sort logic
  const sortType = document.getElementById('sortPuzzles').value;
  let puzzlesToShow = [...state.puzzleData];

  if (sortType === 'completed') {
    puzzlesToShow = puzzlesToShow.filter(p => {
      const key = `bestScore_${p.puzzleLetters}`;
      return localStorage.getItem(key) !== null;
    });
  } else if (sortType === 'uncompleted') {
    puzzlesToShow = puzzlesToShow.filter(p => {
      const key = `bestScore_${p.puzzleLetters}`;
      return localStorage.getItem(key) === null;
    });
  } else if (sortType === 'difficulty') {
    puzzlesToShow.sort((a, b) => a.difficulty - b.difficulty);
  } else if (sortType === 'score') {
    puzzlesToShow = puzzlesToShow
      .map(p => {
        const key = `bestScore_${p.puzzleLetters}`;
        const score = parseFloat(localStorage.getItem(key));
        return isNaN(score) ? null : { ...p, score };
      })
      .filter(p => p !== null)
      .sort((a, b) => a.score - b.score);
  } else {
    puzzlesToShow.sort((a, b) => a.puzzleLetters.localeCompare(b.puzzleLetters));
  }

  puzzlesToShow.forEach(puzzle => {
    const { puzzleLetters, difficulty } = puzzle;
    const bestScoreKey = `bestScore_${puzzleLetters}`;
    const bestScore = localStorage.getItem(bestScoreKey);

    const item = document.createElement('div');
    item.className = 'puzzle-item';
    if (bestScore) {
      item.classList.add('completed');
    }

    const difficultyStars = '★'.repeat(puzzle.difficulty);
    item.innerHTML = `
        <div><strong>${puzzleLetters.toLowerCase()}</strong></div>
        <div class="best-score">${bestScore ? `Best: ${parseFloat(bestScore)}` : `No score yet`}</div>
        <div class="best-score" style="opacity: 0.7; color: var(--marker);">${difficultyStars}</div>
      `;

    item.addEventListener('click', async () => {
      await startNewPuzzle('all', puzzle);
      state.puzzle.isCustom = false;
    });

    puzzleList.appendChild(item);
  });
}

function renderStatistics() {
  const table = document.getElementById('statsTable');
  table.innerHTML = '';

  const longestWord = localStorage.getItem('longestWord') || '—';

  const rareWordObj = JSON.parse(localStorage.getItem('rarestWord') || '{}');
  const rarestWord = rareWordObj.word || '—';

  const longestSylObj = JSON.parse(localStorage.getItem('longestSyllable') || '{}');
  const longestSyllableDisplay = longestSylObj.word
    ? `${longestSylObj.syllable} (in ${longestSylObj.display})`
    : '—';

  const commonSylObj = JSON.parse(localStorage.getItem('mostCommonSyllable') || '{}');
  const commonSyllableDisplay = commonSylObj.syllable
    ? `${commonSylObj.syllable} (${commonSylObj.count})`
    : '—';

  const stats = [
    ['games completed', localStorage.getItem('gamesCompleted') || 0],
    ['total score', localStorage.getItem('totalScore') || 0],
    ['total valid words', localStorage.getItem('totalValidWords') || 0],
    ['total syllable count', localStorage.getItem('totalSyllableCount') || 0],
    ['most common syllable', commonSyllableDisplay],
    ['longest syllable', longestSyllableDisplay],
    ['longest word', longestWord],
    ['rarest word', rarestWord]
  ];

  stats.forEach(([label, value]) => {
    const row = document.createElement('tr');
    row.innerHTML = `<td>${label}</td><td>${value}</td>`;
    table.appendChild(row);
  });

  const statsSection = document.getElementById("statisticsSection");
  const todayKey = getLocalDateString();
  const savedGame = localStorage.getItem(`syllabl_daily_${todayKey}`);
  const existingHowdy = document.getElementById("howDidYouDoButtonStats");

  if (savedGame) {
    const parsed = JSON.parse(savedGame);
    if (parsed.currentStage >= 6) {
      if (existingHowdy) existingHowdy.remove(); // remove stale or previous button

      const howdyadoBtn = document.createElement("button");
      howdyadoBtn.className = "howdyado-button-stats";
      howdyadoBtn.id = 'howDidYouDoButtonStats';
      howdyadoBtn.innerHTML = `<span class="syllable">how</span> <span class="syllable">did</span> <span class="syllable">you</span> <span class="syllable">do</span> <span class="syllable">today?</span> <span class="syllable">→</span>`;

      howdyadoBtn.addEventListener("click", async () => {
        if (howdyadoBtn.disabled) return;
        howdyadoBtn.disabled = true;
        await showHowDidYouDo?.("howDidYouDoButtonStats");
        hideAllScreensExcept("howDidYouDoSection");
      });

      statsSection.appendChild(howdyadoBtn);
      howdyadoBtn.disabled = false;
      howdyadoBtn.style.display = "block";
      howdyadoBtn.style.width = "fit-content";
      howdyadoBtn.style.margin = "20px auto";
      howdyadoBtn.style.padding = "12px 18px";
      howdyadoBtn.style.fontSize = "1.6rem";
      howdyadoBtn.style.cursor = "pointer";
      // Fallback touchend listener for mobile
      howdyadoBtn.addEventListener("touchend", async () => {
        await showHowDidYouDo?.("howDidYouDoButtonStats");
        hideAllScreensExcept("howDidYouDoSection");
      });
    }
  }
}

document.getElementById('playCustomPuzzle')?.addEventListener('click', async () => {
  const puzzleLettersInput = document.getElementById('puzzleLetters');
  const container = document.getElementById('createRows');
  const puzzleData = await validateAllRowsAndBuildPuzzle(puzzleLettersInput, container);

  if (puzzleData) {
    const customPuzzle = {
      puzzleLetters: puzzleData.puzzleLetters,
      inputsEnabled: puzzleData.inputsEnabled,
      syllablesRequired: puzzleData.syllablesRequired,
      isCustom: true
    };

    await startNewPuzzle('custom', customPuzzle);
  }
});

document.getElementById('shareCustomPuzzle').addEventListener('click', async () => {
  const puzzleLettersInput = document.getElementById('puzzleLetters');
  const container = document.getElementById('createRows');
  const puzzleData = await validateAllRowsAndBuildPuzzle(puzzleLettersInput, container);

  if (puzzleData) {
    const shareObject = {
      type: "custom",
      puzzleLetters: puzzleData.puzzleLetters,
      inputsEnabled: puzzleData.inputsEnabled,
      syllablesRequired: puzzleData.syllablesRequired,
      validWords: puzzleData.validWords
    };

    const encoded = btoa(JSON.stringify(shareObject));
    const shareURL = `${window.location.origin}?puzzle=${encoded}`;

    try {
      await navigator.clipboard.writeText(shareURL);
      alert("Shareable link copied to clipboard!");
    } catch (err) {
      console.log("Puzzle JSON:", shareObject);
      alert("Unable to copy. What did you do?");
    }
  }
});

document.getElementById('copyPuzzleJSON').addEventListener('click', () => {
  const puzzleLetters = document.getElementById('puzzleLetters').value.trim().toLowerCase();

  const inputsEnabled = [];
  const syllablesRequired = [];

  const ruleSelects = document.querySelectorAll('#createRows .placement-select');
  const syllableSelects = document.querySelectorAll('#createRows .syllable-select');

  for (let i = 0; i < 6; i++) {
    const ruleValue = parseInt(ruleSelects[i].value, 10);
    const syllableValue = parseInt(syllableSelects[i].value, 10);
    inputsEnabled.push(ruleValue);
    syllablesRequired.push(syllableValue);
  }

  const difficulty = 0; // Optionally calculate this dynamically

  const puzzleJSON = {
    puzzleLetters,
    difficulty,
    inputsEnabled,
    syllablesRequired
  };

  const jsonString = JSON.stringify(puzzleJSON, null, 2);

  navigator.clipboard.writeText(jsonString)
    .then(() => {
      alert("✅ Puzzle JSON copied to clipboard!");
    })
    .catch(err => {
      console.error("Copy failed:", err);
      alert("❌ Failed to copy JSON.");
    });
});

async function maybeLoadSharedPuzzle() {
  const urlParams = new URLSearchParams(window.location.search);
  const puzzleParam = urlParams.get('puzzle');

  if (!puzzleParam) return false;

  try {
    const decoded = atob(puzzleParam);
    const puzzleData = JSON.parse(decoded);

    if (puzzleData.type === "custom") {
      await loadFeedback();

      state.puzzle = {
        puzzleLetters: puzzleData.puzzleLetters,
        inputsEnabled: puzzleData.inputsEnabled,
        syllablesRequired: puzzleData.syllablesRequired,
        isCustom: true
      };

      state.mode = 'custom';
      state.currentStage = 0;
      state.score = 0;
      state.guesses = [];

      document.getElementById('homeScreen').style.display = 'none';
      document.getElementById('createPuzzleSection').style.display = 'none';
      document.getElementById('howToPlaySection').style.display = 'none';
      document.getElementById('game').style.display = 'flex';

      updateUI();
      displayGreetingMessage();
      document.getElementById('guessInput').focus();

      return true;
    }
  } catch (err) {
    console.error("Failed to load shared puzzle:", err);
    alert("Something went wrong trying to load this puzzle link.");
  }

  return false;
}

async function submitDailyPerformance() {

  if (state.mode !== 'daily' || !state.puzzle || state.guesses.length === 0) return;

  const payload = {
    action: 'submit', // backend may use this to switch logic
    userId: getAnonUserId(), // a persistent anon ID in localStorage or a hash
    puzzleDate: getLocalDateString(),
    puzzleLetters: state.puzzle.puzzleLetters,
    completed: state.currentStage >= 6,
    finalScore: state.score,
    stagesCompleted: state.currentStage,
    totalSyllablesUsed: state.guesses.reduce((sum, g) => sum + g.syllables, 0),
    longestWord: state.guesses.reduce((longest, g) => g.word.length > longest.length ? g.word : longest, ""),
    rarestWord: state.guesses.reduce((rarest, g) => !rarest.word || g.frequency < rarest.frequency ? { word: g.word, frequency: g.frequency } : rarest, { word: "", frequency: Infinity }),
    entries: state.guesses.map((g, i) => ({
      stage: i + 1,
      word: g.word,
      frequency: g.frequency,
      score: g.score,
      syllables: g.syllables,
      length: g.word.length,
      placement: state.puzzle.inputsEnabled[i]
    })),
    avgWordLength: avg(state.guesses.map(g => g.word.length)),
    avgWordFrequency: avg(state.guesses.map(g => g.frequency)),
    avgSyllablesPerWord: avg(state.guesses.map(g => g.syllables))
  };

  try {
    const res = await fetch("https://kek5jftl69.execute-api.us-east-1.amazonaws.com/leaderboard", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const result = await res.json();
    if (!res.ok) throw new Error(result.error || "Submission failed");
    console.log("[Syllabl] Submission success:", result);
  } catch (err) {
    console.error("[Syllabl] Submission error:", err.message);
  }
}

if (!crypto.randomUUID) {
  crypto.randomUUID = () => {
    // Fallback UUID generator
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  };
}

function getAnonUserId() {
  const key = 'syllabl_user_id';
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(key, id);
  }
  return id;
}

// Helper: Simple average
function avg(arr) {
  if (!arr.length) return 0;
  return arr.reduce((sum, val) => sum + val, 0) / arr.length;
}

async function showHowDidYouDo(fromWhere) {
  const today = getLocalDateString();
  const userId = getAnonUserId?.() || "unknown";

  try {
    const res = await fetch(`https://kek5jftl69.execute-api.us-east-1.amazonaws.com/leaderboard?puzzleDate=${today}`);
    const { entries = [] } = await res.json();
    allEntries = entries;

    const userEntry = entries.find(e => e.userId === userId);
    if (!userEntry) {
      alert("We couldn't find your result for today.");
      return;
    }

    flipbookSlides = [];

    // Slide 1: Overview graph
    const minPossible = 6;
    const maxPossible = 30;
    const userScore = userEntry.finalScore;

    const globalScores = entries.map(e => e.finalScore);
    const bestScore = Math.max(...globalScores);
    const worstScore = Math.min(...globalScores);
    const avgScore = globalScores.reduce((a, b) => a + b, 0) / globalScores.length;

    // Find percentile rank
    const sorted = [...globalScores].sort((a, b) => a - b);
    const userRankIndex = sorted.findIndex(score => score === userEntry.finalScore);
    const percentile = Math.floor((userRankIndex / sorted.length) * 100);

    // Determine performance tier
    let tierDescription = "";
    if (userEntry.finalScore === bestScore) {
      tierDescription = "whoa!";
    } else if (userEntry.finalScore === worstScore) {
      tierDescription = "hey, you finished the puzzle. that's worth celebrating!";
    } else if (percentile >= 75) {
      tierDescription = "you dug up some hidden gems today, and it brought your score to the top. way to go!";
    } else if (percentile >= 50) {
      tierDescription = "you found some pretty obscure words today, and it shows - your score was well above average!";
    } else if (percentile >= 25) {
      tierDescription = "you used some uncommon words today! give yourself a pat on the back.";
    } else {
      tierDescription = "welcome to the winner's club - how does it feel?";
    }

    const minActual = Math.min(...globalScores);
    const maxActual = Math.max(...globalScores);
    const scoreRange = maxPossible - minPossible;

    const positionPercent = (score) => ((score - minPossible) / scoreRange) * 100;

    flipbookSlides.push(`
        <h3>results</h3>
        <div class="tooltip-container" style="display: inline-block; margin-left: 8px; vertical-align: middle;">
          <span class="tooltip-icon">?</span>
            <div class="tooltip-box">
              <p>this chart shows how <strong>your final score</strong> stacks up against scores from <strong>all players who submitted results today</strong>.</p><br>
              <p>the <strong>lowest possible score</strong> is <strong>6</strong>, and the <strong>highest possible score</strong> is <strong>30</strong>. these values are shown at either end of the chart.</p><br>
              <p>the <strong>shaded bar</strong> highlights the full range of scores submitted so far today. <strong>your score</strong> is marked on the graph with the label <strong>'you'</strong>.</p>
            </div>
        </div>
        <p style="margin-top: 1rem;">today, you earned a total of <strong>${userEntry.finalScore}</strong> points. ${tierDescription ? ` ${tierDescription}` : ''}</p>
        <div id="scoreRangeChartContainer"></div>
        <div class="score-range-chart">
          <div class="score-nums">
            <div class="score-num" style="left: ${positionPercent(minPossible)}%;">${minPossible}</div>
            <div class="score-num optional-score-marker" style="left: ${positionPercent(minActual)}%;">${minActual}</div>
            <div class="score-num" style="left: ${positionPercent(userScore)}%;">${userScore}</div>
            <div class="score-num optional-score-marker" style="left: ${positionPercent(maxActual)}%;">${maxActual}</div>
            <div class="score-num" style="left: ${positionPercent(maxPossible)}%;">${maxPossible}</div>
          </div>
          <div class="score-track">
            <div class="score-range-band" style="left: ${positionPercent(minActual)}%; width: ${positionPercent(maxActual) - positionPercent(minActual)}%;"></div>
            <div class="score-marker min-possible" style="left: ${positionPercent(minPossible)}%;"></div>
            <div class="score-marker min-actual" style="left: ${positionPercent(minActual)}%;"></div>
            <div class="score-marker user-marker" style="left: ${positionPercent(userScore)}%;"></div>
            <div class="score-marker max-actual" style="left: ${positionPercent(maxActual)}%;"></div>
            <div class="score-marker max-possible" style="left: ${positionPercent(maxPossible)}%;"></div>
          </div>
          <div class="score-labels">
            <div class="score-label you-indicator" style="left: ${positionPercent(userScore)}%;">
              <div class="you-arrow"></div>
              <div class="you-label">you</div>
            </div>
          </div>
        </div>
          ${userEntry.finalScore === bestScore ?
        `<p style="margin-top: 1rem; padding-top: 10px;"><strong>you have the best score today so far!</strong></p>` :
            userEntry.finalScore === worstScore ?
        `<p style="margin-top: 1rem; padding-top: 10px;">try to find more uncommon words next time.</p>` :
        `<p style="margin-top: 1rem; padding-top: 10px;">you placed better than <strong>${percentile}%</strong> of players!</p>`
          }  
        <p style="margin-top: 1rem;">let's see how your words stacked up →</p>    
    `);

    // Slides 2–7: Stage-by-stage word comparison
    for (let i = 0; i < 6; i++) {
      const userEntryAtStage = userEntry.entries?.[i];
      if (!userEntryAtStage?.word || userEntryAtStage.frequency == null) continue;
      const puzzleInputs = state.puzzle?.inputsEnabled;
      const puzzleSyllables = state.puzzle?.syllablesRequired;
      const puzzleLetters = state.puzzle?.puzzleLetters;
      const rule = puzzleInputs?.[i];
      const syllables = puzzleSyllables?.[i];
      const ruleText = `<p style="margin-bottom: 15px;">your word had to ${describeRule(rule)} ${puzzleLetters} and contain ${syllables} ${syllables === 1 ? 'syllable' : 'syllables'}.</p>`;

      const { word: userWord, frequency: userFreq, score: userScore } = userEntryAtStage;

      const allValidWords = entries
        .map(e => e.entries?.[i]?.word)
        .filter(Boolean);

      const rarestAtStage = entries
        .map(e => e.entries?.[i])
        .filter(e => e?.word && e.frequency != null)
        .reduce((min, cur) => (cur.frequency < min.frequency ? cur : min), { frequency: Infinity });

      const userHasRarest = userWord === rarestAtStage.word;

      const wordFrequencyMap = {};
      for (const word of allValidWords) {
        wordFrequencyMap[word] = (wordFrequencyMap[word] || 0) + 1;
      }

      let mostCommonWord = "";
      let highestCount = 0;

      for (const [word, count] of Object.entries(wordFrequencyMap)) {
        if (count > highestCount) {
          mostCommonWord = word;
          highestCount = count;
        }
      }

      const mostCommonEntry = entries
        .map(e => e.entries?.[i])
        .find(e => e?.word === mostCommonWord);

      const commonWordScore = mostCommonEntry?.score ?? determineScoreFromFrequency(mostCommonEntry?.frequency ?? 0);

      const styledCommonWord = `
        <div class="guessItem" style="
          margin: 12px auto;
          background-color: ${getColorForScore(commonWordScore)};
          border-color: ${getColorForScore(commonWordScore)};
          justify-content: center;
          width: fit-content;
          gap: 5px;
        ">
          <span class="guessbox">${mostCommonWord}</span>
          <span class="score">${commonWordScore}</span>
        </div>`;

      const styledUserWord = `
      <div class="guessItem" style="
        margin: 12px auto;
        background-color: ${getColorForScore(userScore)};
        border-color: ${getColorForScore(userScore)};
        justify-content: center;
        width: fit-content;
        gap: 5px;
      ">
        <span class="guessbox">${userWord}</span>
        <span class="score">${userScore}</span>
      </div>`;

      const styledRarestWord = userHasRarest
        ? styledUserWord
        : `
      <div class="guessItem" style="
        margin: 12px auto;
        background-color: ${getColorForScore(rarestAtStage.score)};
        border-color: ${getColorForScore(rarestAtStage.score)};
        justify-content: center;
        width: fit-content;
        gap: 5px;
      ">
        <span class="guessbox">${rarestAtStage.word}</span>
        <span class="score">${rarestAtStage.score}</span>
      </div>`;

      const rarestText = userHasRarest
        ? "<p><strong>you found the rarest word for this stage so far!</strong></p>"
        : `<p>the rarest word used: ${styledRarestWord}</p>`;

      flipbookSlides.push(`
        <h3>stage ${i + 1}</h3>
        ${ruleText}
        <p>the most commonly used word among other players:</p>
        ${styledCommonWord}
        <p>your word:</p>
        ${styledUserWord}
        ${rarestText}
      `);
    }

    // Slide 8: Rarest word
    const globalRarest = entries.reduce((min, e) => {
      if (!e.rarestWord) return min;
      return (!min || e.rarestWord.frequency < min.frequency) ? e.rarestWord : min;
    }, null);

    const userRarest = userEntry.rarestWord;

    // Dynamically assign scores based on frequency
    globalRarest.score = determineScoreFromFrequency(globalRarest.frequency);
    userRarest.score = determineScoreFromFrequency(userRarest.frequency);

    const userHasRarest = userRarest.word === globalRarest.word;

    const styledGlobal = `
      <div class="guessItem" style="
        margin: 12px auto;
        background-color: ${getColorForScore(globalRarest.score)};
        border-color: ${getColorForScore(globalRarest.score)};
        justify-content: center;
        width: fit-content;
        gap: 5px;
      ">
        <span class="guessbox">${globalRarest.word}</span>
        <span class="score">${globalRarest.score}</span>
      </div>`;

    const styledUser = `
      <div class="guessItem" style="
        margin: 12px auto;
        background-color: ${getColorForScore(userRarest.score)};
        border-color: ${getColorForScore(userRarest.score)};
        justify-content: center;
        width: fit-content;
        gap: 5px;
      ">
        <span class="guessbox">${userRarest.word}</span>
        <span class="score">${userRarest.score}</span>
      </div>`;

    const rarestText = userHasRarest
      ? `<p><strong>you found the rarest word of the day!</strong></p>${styledUser}<p>you've got a pretty rich vocabulary.</p>`
      : `<p>the rarest word used today:</p>${styledGlobal}<p>your rarest word:</p>${styledUser}`;

    flipbookSlides.push(`
      <h3>rarest word</h3>
      ${rarestText}
    `);

    // Slide 9: Unique words
    const allUsedWords = new Set(entries.flatMap(e => e.entries.map(w => w.word)));
    const yourUniqueWords = userEntry.entries
      .map(e => e.word)
      .filter(w => w && entries.filter(e => e.entries.some(x => x.word === w)).length === 1);

    if (yourUniqueWords.length > 0) {
      const formattedWords = yourUniqueWords.map(word => {
        const guess = userEntry.entries.find(e => e.word === word);
        const score = guess?.score ?? determineScoreFromFrequency(guess?.frequency ?? 0);
        const color = getColorForScore(score);

        return `
          <div class="guessItem" style="
            margin: 12px auto;
            background-color: ${color};
            border-color: ${color};
            justify-content: center;
            width: fit-content;
            gap: 5px;
          ">
            <span class="guessbox">${word}</span>
            <span class="score">${score}</span>
          </div>`;
      }).join("");

      flipbookSlides.push(`
        <h3>your unique words</h3>
        <p style="margin-bottom: 20px;">you were the only person to use these words:</p>${formattedWords}
      `);
    }

    // Slide 9: Longest word
    const longestWordGlobal = entries.reduce((longest, e) => {
      const entryLongest = e.entries.reduce((acc, curr) =>
        curr.word.length > acc.word.length ? curr : acc, { word: "", score: 0, frequency: 0 });
      return entryLongest.word.length > longest.word.length ? entryLongest : longest;
    }, { word: "", score: 0, frequency: 0 });

    const longestWordUser = userEntry.entries.reduce((acc, curr) =>
      curr.word.length > acc.word.length ? curr : acc, { word: "", score: 0, frequency: 0 });

    const userHasLongest = longestWordUser.word === longestWordGlobal.word;

    const styledGlobalLongest = `
      <div class="guessItem" style="
        margin: 12px auto;
        background-color: ${getColorForScore(longestWordGlobal.score)};
        border-color: ${getColorForScore(longestWordGlobal.score)};
        justify-content: center;
        width: fit-content;
        gap: 5px;
      ">
        <span class="guessbox">${longestWordGlobal.word}</span>
        <span class="score">${longestWordGlobal.score}</span>
      </div>`;

    const styledUserLongest = `
      <div class="guessItem" style="
        margin: 12px auto;
        background-color: ${getColorForScore(longestWordUser.score)};
        border-color: ${getColorForScore(longestWordUser.score)};
        justify-content: center;
        width: fit-content;
        gap: 5px;
      ">
        <span class="guessbox">${longestWordUser.word}</span>
        <span class="score">${longestWordUser.score}</span>
      </div>`;

    const longestText = userHasLongest
      ? `${styledUserLongest}<p><strong>you found the longest word used today!</strong></p>`
      : `<p>the longest word used today:</p>${styledGlobalLongest}<p>your longest word:</p>${styledUserLongest}`;

    flipbookSlides.push(`
      <h3>longest word</h3>
      ${longestText}
    `);

    // Slide 10: Word Cloud
    flipbookSlides.push(`
      <h3>thanks for playing!</h3>
      <div id="wordCloudContainer""></div>
    `);

    // Store and display
    window.flipbookSlides = flipbookSlides;
    window.currentSlide = 0;
    updateFlipbookUI(fromWhere);
    hideAllScreensExcept("howDidYouDoSection");
  } catch (err) {
    console.error("Failed to load leaderboard data:", err);
    alert("There was an error loading your performance data.");
  }
}

function updateFlipbookUI(fromWhere) {
  const flipbookContent = document.getElementById('flipbookContent');
  const prevButton = document.getElementById('prevSlide');
  const nextButton = document.getElementById('nextSlide');

  if (!window.flipbookSlides || window.flipbookSlides.length === 0) {
    flipbookContent.innerHTML = "<p>No data to display.</p>";
    prevButton.disabled = true;
    nextButton.disabled = true;
    return;
  }

  // Clamp the currentSlide index
  window.currentSlide = Math.max(0, Math.min(window.currentSlide, window.flipbookSlides.length - 1));

  // Show current slide content
  flipbookContent.innerHTML = window.flipbookSlides[window.currentSlide];

  // Render the word cloud if on the final slide
  const wordCloudEl = flipbookContent.querySelector('#wordCloudContainer');

  if (wordCloudEl) {
    const words = allEntries.flatMap(e => e.entries.map(w => w.word));
    renderWordCloud(words);
  }

  // First slide → "back" to game
  if (window.currentSlide === 0) {
    prevButton.textContent = "back";
    prevButton.disabled = false;
    if (fromWhere === "howDidYouDoButtonStats") {
      prevButton.onclick = () => {
        renderStatistics();
        hideAllScreensExcept("statisticsSection");
      };
    } else if (fromWhere === "howDidYouDoButtonGame") {
      prevButton.onclick = () => hideAllScreensExcept("game");
      animateGameEntry();
    } else if (!fromWhere) {
      prevButton.onclick = () => hideAllScreensExcept("homeScreen")
      resetHomeAnimations(); // ✨ triggers syllable animations
    } else {
      prevButton.onclick = () => hideAllScreensExcept("game");
      animateGameEntry();
    }
  } else {
    prevButton.textContent = "previous";
    prevButton.disabled = false;
    prevButton.onclick = () => {
      window.currentSlide = Math.max(0, window.currentSlide - 1);
      updateFlipbookUI(fromWhere);
    };
  }

  // Last slide → "home"
  if (window.currentSlide === window.flipbookSlides.length - 1) {
    nextButton.textContent = 'home';
    nextButton.disabled = false;
    nextButton.onclick = () => {
      state.hasFlippedPuzzleTitle = false; // ✅ Reset the flip state
      window.currentSlide = 0;
      hideAllScreensExcept("homeScreen");
      resetHomeAnimations(); // ✨ triggers syllable animations
    };
  } else {
    nextButton.textContent = "next";
    nextButton.disabled = false;
    nextButton.onclick = () => {
      window.currentSlide = Math.min(window.flipbookSlides.length - 1, window.currentSlide + 1);
      updateFlipbookUI(fromWhere);
    };
  }
}

function triggerSyllableBounce(button) {
  const children = button.querySelectorAll('.syllable, .interpunct');
  children.forEach((el, i) => {
    setTimeout(() => {
      el.classList.add('bounce');
      setTimeout(() => el.classList.remove('bounce'), 600);
    }, i * 100);
  });
}

function startRandomButtonBounce() {
  const buttons = document.querySelectorAll('.home-button');
  setInterval(() => {
    const visibleButtons = Array.from(document.querySelectorAll('.home-button')).filter(btn => btn.offsetParent !== null);
    if (visibleButtons.length === 0) return;

    const maxButtons = Math.min(4, visibleButtons.length);
    const sampleSize = Math.floor(Math.random() * maxButtons) + 1; // 1 to maxButtons

    const sampled = [...visibleButtons].sort(() => 0.5 - Math.random()).slice(0, sampleSize);
    sampled.forEach(triggerSyllableBounce);
  }, Math.floor(Math.random() * 3000) + 2000); // every 2–5s  
}

// Wait for animation to finish on last grid item
(function () {
  const gridItems = document.querySelectorAll('.button-grid > *');
  const lastItem = gridItems[gridItems.length - 1];
  if (lastItem) {
    lastItem.addEventListener('animationend', () => {
      startRandomButtonBounce();
    }, { once: true });
  }
})();

document.querySelectorAll('.home-button').forEach(button => {
  button.addEventListener('mouseenter', () => {
    const targets = button.querySelectorAll('.syllable, .interpunct');
    targets.forEach((el, i) => {
      setTimeout(() => {
        el.classList.remove('bounce'); // reset first
        void el.offsetWidth;           // force reflow
        el.classList.add('bounce');
        setTimeout(() => el.classList.remove('bounce'), 600);
      }, i * 80); // staggered bounce
    });
  });
});

// Trigger staggered syllable bounce on click instead of hover
document.addEventListener('click', function (e) {
  const button = e.target.closest('.howdyado-button, .howdyado-button-stats');
  if (!button) return;

  const targets = button.querySelectorAll('.syllable, .interpunct');
  targets.forEach((el, i) => {
    setTimeout(() => {
      el.classList.remove('bounce');
      void el.offsetWidth;
      el.classList.add('bounce');
      setTimeout(() => el.classList.remove('bounce'), 600);
    }, i * 80);
  });
});

function animateHomeExit() {
  return new Promise(resolve => {
    const title = document.getElementById('homeTitle');
    const buttons = Array.from(document.querySelectorAll('.button-grid > *'));
    const totalDelay = 800;

    if (title) {
      title.style.animation = '';
      title.classList.add('fade-out');
    }

    buttons.reverse().forEach((btn, i) => {
      btn.style.animation = ''; // remove inline fadeInUp
      setTimeout(() => {
        btn.classList.add('fade-out');
      }, i * 50);
    });

    setTimeout(resolve, totalDelay);
  });
}

function resetHomeAnimations() {
  const title = document.getElementById('homeTitle');
  const buttons = document.querySelectorAll('.button-grid > *');

  if (title) {
    title.classList.remove('fade-out');
    void title.offsetWidth; // force reflow to re-trigger animation
    title.classList.remove('animate-once'); // remove any leftover animation classes
    title.classList.add('animate-once');
  }

  buttons.forEach((btn, i) => {
    btn.classList.remove('fade-out');
    void btn.offsetWidth; // force reflow
    btn.style.animation = 'none';
    // Restore fade-in animation
    btn.style.opacity = '0';
    btn.style.animation = `fadeInUp 0.4s ease forwards`;
    btn.style.animationDelay = `${getButtonDelay(i)}s`;
  });
}

function animateGameEntry() {
  const logo = document.getElementById('gameTitle');
  const puzzleInfo = document.querySelector('.puzzle-title');
  const input = document.querySelector('.input-container');
  const feedback = document.getElementById('feedback');
  const guessLog = document.getElementById('guessLog');
  const backToHomeFromGame = document.getElementById('backToHomeFromGame')

  const items = [input, feedback, guessLog, logo, backToHomeFromGame];

  // Animate the puzzleInfo container
  if (puzzleInfo) {
    puzzleInfo.classList.remove('flip-in');
    void puzzleInfo.offsetWidth; // force reflow
    puzzleInfo.classList.add('flip-in');
  }

  // Animate other items with slide-in delays
  items.forEach((el, i) => {
    if (el) {
      el.classList.remove('animate-slide-in', `animate-delay-${i + 1}`);
      void el.offsetWidth;
      el.classList.add('animate-slide-in', `animate-delay-${i + 1}`);
    }
  });

  state.hasAnimatedFeedback = false;
}

function getButtonDelay(index) {
  const delays = [0.75, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4];
  return delays[index] ?? 0.05;
}

function renderSyllableCloud() {
  const cloud = document.getElementById('syllableCloud');
  if (!cloud) return;

  cloud.innerHTML = '';

  const counts = JSON.parse(localStorage.getItem('syllableCounts') || '{}');
  const keys = Object.keys(counts);
  const maxCount = Math.max(...Object.values(counts));

  keys.forEach((syl) => {
    const sizeScale = 0.75 + (counts[syl] / maxCount) * 2.5;
    const span = document.createElement('span');
    span.classList.add('syllable-cloud-word');
    span.textContent = syl;

    // 🎯 Epicenter: 50% / 50%, plus random offset
    const xOffset = (Math.random() - 0.5) * 100; // -50% to +50%
    const yOffset = (Math.random() - 0.5) * 100; // -50% to +50%

    span.style.left = `calc(50% + ${xOffset}%)`;
    span.style.top = `calc(50% + ${yOffset}%)`;
    span.style.fontSize = `${sizeScale}rem`;
    span.style.animationDelay = `${Math.random() * 10}s`;

    cloud.appendChild(span);
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  // 1. Apply saved theme
  const savedTheme = localStorage.getItem('preferredTheme');
  if (savedTheme) {
    document.documentElement.setAttribute('data-theme', savedTheme);
    const currentBtn = document.querySelector(`.theme-button[data-theme="${savedTheme}"]`);
    if (currentBtn) currentBtn.classList.add('current-theme');
  }

  // 2. Setup homepage buttons and listeners
  setupPuzzleButtons();

  // 3. Try loading a shared puzzle
  const loadedSharedPuzzle = await maybeLoadSharedPuzzle();
  if (loadedSharedPuzzle) {
    hideAllScreensExcept('game');
    animateGameEntry();
  } else {
    hideAllScreensExcept('homeScreen');
  }

  // 4. Render syllable cloud (previously in `window.onload`)
  renderSyllableCloud();
});