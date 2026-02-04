// ==========================================
// ⚠️ 重要: これはブラウザ用のコードです
// ⚠️ Google Apps Script (GAS) には貼り付けないでください！
// ⚠️ GAS用には 'transcription.js' を使ってください
// ==========================================
// 設定
// ==========================================
const CONFIG = {
  // Google Drive フォルダID (クライアント側では使用せず、GAS側で管理)
  // VOICE_FOLDER_ID: '1jbVLfqRoYHjy4MlBhGiFcOEy6pNd957O', 

  // 録音設定
  CHUNK_DURATION: 5 * 60 * 1000, // 5分（ミリ秒）
  MAX_DURATION: 60 * 60 * 1000,  // 60分（ミリ秒）
  MAX_CHUNKS: 12,                 // 最大チャンク数（60分 / 5分）

  // 音声設定
  MIME_TYPE: 'audio/webm;codecs=opus',
  FILE_EXTENSION: '.webm',

  // 報告書作成API (GAS Web App URL)
  // ※デプロイ後にURLをここに貼り付けてください
  REPORT_API_URL: 'https://script.google.com/macros/s/AKfycbwotAxtlbg4ZmicgjfivUJP3sbPvvi8fPFGsPMt9G7RuNuEJwH-AJYBP5cIIT8uim0Big/exec'
};

// ==========================================
// グローバル変数
// ==========================================
let mediaRecorder = null;
let audioStream = null;
let recordingStartTime = null;
let currentChunk = 0;
let timerInterval = null;
let chunkInterval = null;
let audioChunks = [];
let uploadedChunks = 0;
let sessionId = null;

// DOM要素
const mainSection = document.getElementById('mainSection');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const statusText = document.getElementById('statusText');
const chunkCount = document.getElementById('chunkCount');
const uploadCount = document.getElementById('uploadCount');
const timer = document.getElementById('timer');
const progressBar = document.getElementById('progressBar');
const logBox = document.getElementById('logBox');


// ==========================================
// 初期化
// ==========================================
window.onload = () => {
  log('アプリ起動');

  // 認証なしで即座にアプリを表示
  mainSection.classList.remove('hidden');

  startBtn.addEventListener('click', () => startRecording(false)); // 新規録音

  const continueBtn = document.getElementById('continueBtn');
  if (continueBtn) {
    continueBtn.addEventListener('click', () => startRecording(true)); // 続きから録音
  }

  stopBtn.addEventListener('click', stopRecording);

  // 手動アップロード設定
  const manualUploadBtn = document.getElementById('manualUploadBtn');
  const manualFileInput = document.getElementById('manualFileInput');

  if (manualUploadBtn && manualFileInput) {
    manualUploadBtn.addEventListener('click', () => manualFileInput.click());
    manualFileInput.addEventListener('change', handleManualUpload);
  }

  // 報告書作成ボタン
  const createReportBtn = document.getElementById('createReportBtn');
  if (createReportBtn) {
    createReportBtn.addEventListener('click', handleCreateReport);
  }

  // セッション復元チェック
  checkPreviousSession();
};

function checkPreviousSession() {
  const lastSession = localStorage.getItem('sns_rec_session');
  if (lastSession) {
    const continueBtn = document.getElementById('continueBtn');
    if (continueBtn) continueBtn.style.display = 'inline-block';

    // UI表示更新
    const data = JSON.parse(lastSession);
    log(`💡 前回のセッションが見つかりました: ${data.id} (Chunk ${data.currentChunk})`);
  }
}

// ==========================================
// 認証処理 (廃止)
// ==========================================

// ==========================================
// 録音開始 (isContinue: 続きからかどうか)
// ==========================================
async function startRecording(isContinue = false) {
  try {
    // ⚡️ 即座にボタンを無効化してダブルクリック防止＆「反応中」を示す
    const btn = isContinue ? document.getElementById('continueBtn') : startBtn;
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = '⏳ 準備中...';

    // 続きからボタンも無効化（誤操作防止）
    const continueBtn = document.getElementById('continueBtn');
    if (continueBtn) continueBtn.disabled = true;
    startBtn.disabled = true;

    log(isContinue ? '録音を再開します...' : '録音を開始します...');

    // マイク権限を取得
    audioStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        sampleRate: 48000
      }
    });

    log('✅ マイク接続成功');

    // MediaRecorderを初期化
    mediaRecorder = new MediaRecorder(audioStream, {
      mimeType: CONFIG.MIME_TYPE,
      audioBitsPerSecond: 128000 // 128kbps
    });

    if (isContinue) {
      // 続きから: localStorageから復元
      const savedData = JSON.parse(localStorage.getItem('sns_rec_session'));
      sessionId = savedData.id;
      currentChunk = savedData.currentChunk; // 次のチャンク番号
      uploadedChunks = 0; // 表示用カウンタはリセットしても良いが、続き番号は重要

      log(`📝 セッション再開: ${sessionId} (Start from Chunk ${currentChunk})`);
    } else {
      // 新規: セッションIDを生成（YYMMDDHHmmss形式）
      const now = new Date();
      sessionId = formatDate(now) + '_' +
        String(now.getHours()).padStart(2, '0') +
        String(now.getMinutes()).padStart(2, '0') +
        String(now.getSeconds()).padStart(2, '0');

      currentChunk = 0;
      uploadedChunks = 0;

      log(`📝 新規セッションID: ${sessionId}`);
    }

    // セッション情報を保存
    saveSessionInfo();

    // 録音データの蓄積
    audioChunks = [];
    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        audioChunks.push(event.data);
      }
    };

    // 録音開始
    recordingStartTime = Date.now();

    mediaRecorder.start();

    // UIを更新 (ここでStopボタンに切り替え)
    startBtn.classList.add('hidden');
    stopBtn.classList.remove('hidden');

    // ボタンの状態をリセット（次に表示されるときのために）
    btn.disabled = false;
    btn.textContent = originalText;
    if (continueBtn) continueBtn.disabled = false;
    startBtn.disabled = false;

    statusText.innerHTML = '<span class="recording-indicator"></span>録音中';

    // タイマー開始
    startTimer();

    // 5分ごとのチャンク処理
    scheduleNextChunk();

    log('🎤 録音開始');

  } catch (error) {
    log(`❌ 録音開始エラー: ${error.message}`, 'error');
    alert('マイクの起動に失敗しました: ' + error.message);

    // エラー時の復帰
    startBtn.disabled = false;
    startBtn.textContent = '録音開始';
    const continueBtn = document.getElementById('continueBtn');
    if (continueBtn) {
      continueBtn.disabled = false;
      continueBtn.textContent = '⏯️ 続きから録音';
    }
  }
}

// ==========================================
// 録音停止
// ==========================================
function stopRecording() {
  log('録音を停止します...');

  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();

    // 最後のチャンクを処理
    mediaRecorder.onstop = async () => {
      if (audioChunks.length > 0) {
        currentChunk++;
        await processChunk();
      }

      cleanup();
      log('✅ 録音完了');
    };
  } else {
    cleanup();
  }
}

// ==========================================
// チャンクスケジューリング
// ==========================================
function scheduleNextChunk() {
  chunkInterval = setTimeout(async () => {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      log(`⏸️ チャンク ${currentChunk + 1} を保存中...`);

      // 録音を一時停止してチャンクを確定
      mediaRecorder.stop();

      mediaRecorder.onstop = async () => {
        currentChunk++;
        await processChunk();

        // 60分に達していない場合は録音を再開
        const elapsed = Date.now() - recordingStartTime;
        if (elapsed < CONFIG.MAX_DURATION && currentChunk < CONFIG.MAX_CHUNKS) {
          audioChunks = [];
          mediaRecorder.start();
          scheduleNextChunk();
        } else {
          log('⏹️ 最大録音時間に達しました');
          stopRecording();
        }
      };
    }
  }, CONFIG.CHUNK_DURATION);
}

// ==========================================
// チャンク処理（アップロード）
// ==========================================
async function processChunk() {
  if (audioChunks.length === 0) return;

  const blob = new Blob(audioChunks, { type: CONFIG.MIME_TYPE });
  const chunkNumber = String(currentChunk).padStart(2, '0');
  const fileName = `${sessionId}_chunk${chunkNumber}${CONFIG.FILE_EXTENSION}`;

  log(`📤 アップロード中: ${fileName} (${(blob.size / 1024 / 1024).toFixed(2)} MB)`);

  try {
    await uploadToGAS(blob, fileName);

    uploadedChunks++;

    log(`✅ アップロード完了: ${fileName}`);
    updateUI();
    updateSessionChunk(); // 次回のために保存

  } catch (error) {
    log(`❌ アップロード失敗: ${error.message}`, 'error');

    // 自動ダウンロード（救済措置）
    log(`💾 自動保存を実行します: ${fileName}`);
    downloadChunk(blob, fileName);
    alert(`アップロードに失敗しました。\nファイル「${fileName}」を端末に保存しました。\n後で手動アップロードしてください。`);
  }
}

// ==========================================
// 手動アップロード処理
// ==========================================
async function handleManualUpload(e) {
  const file = e.target.files[0];
  if (!file) return;

  // ファイル名形式チェック
  // 例: 240201_143000_chunk01.webm
  const validPattern = /^\d{6}_\d{6}_chunk\d{2}\.webm$/;
  if (!validPattern.test(file.name)) {
    alert('⚠️ ファイル名が無効です。\n「YYMMDD_HHmmss_chunkXX.webm」の形式である必要があります。\n名前を変更せずにアップロードしてください。');
    e.target.value = ''; // リセット
    return;
  }

  log(`📤 手動アップロード開始: ${file.name}`);

  try {
    // FileオブジェクトはBlobの一種なのでそのまま渡せる
    await uploadToGAS(file, file.name);
    log(`✅ 手動アップロード成功: ${file.name}`);
    alert(`アップロード成功: ${file.name}`);
  } catch (error) {
    log(`❌ 手動アップロード失敗: ${error.message}`, 'error');
    alert(`アップロード失敗: ${error.message}`);
  }

  e.target.value = ''; // リセット
}

// ==========================================
// 報告書作成リクエスト
// ==========================================
async function handleCreateReport() {
  if (!CONFIG.REPORT_API_URL) {
    alert('⚠️ GAS WebアプリのURLが設定されていません。\napp.jsの CONFIG.REPORT_API_URL を設定してください。');
    return;
  }

  if (!confirm('報告書を作成しますか？\n（すべての音声アップロードが完了していることを確認してください）')) {
    return;
  }

  log('📑 SNS投稿文の生成をリクエスト中...');
  const btn = document.getElementById('createReportBtn');
  btn.disabled = true;
  btn.textContent = '⏳ 作成中...';

  try {
    // GAS Web App へ POST リクエスト
    // no-cors モード: レスポンスの中身は見れないが、実行はされる
    await fetch(CONFIG.REPORT_API_URL, {
      method: 'POST',
      mode: 'no-cors',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ action: 'create_report' })
    });

    log('✅ 作成リクエストを送信しました。メールを確認してください。');
    alert('リクエストを受け付けました。\n処理完了まで数分かかる場合があります。\n完了後、メールで通知されます。');

  } catch (error) {
    log(`❌ リクエスト送信失敗: ${error.message}`, 'error');
    alert('送信に失敗しました。');
  } finally {
    btn.disabled = false;
    btn.textContent = '✍️ SNS投稿文を生成して送信';
  }
}

// ==========================================
// ローカル保存（ダウンロード）
// ==========================================
function downloadChunk(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.style.display = 'none';
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  }, 100);
}
// ==========================================
// GAS Web App へアップロード (認証不要)
// ==========================================
async function uploadToGAS(blob, fileName) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(blob);
    reader.onloadend = async () => {
      try {
        const base64Data = reader.result.split(',')[1];

        const response = await fetch(CONFIG.REPORT_API_URL, {
          method: 'POST',
          mode: 'no-cors', // クロスオリジン許可（レスポンスは見れないが送信は可能）
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            action: 'upload_chunk',
            fileName: fileName,
            fileData: base64Data
          })
        });

        // no-corsなのでレスポンスの中身は確認できないが、エラーが出なければ成功とみなす
        resolve({ status: 'sent' });

      } catch (e) {
        reject(e);
      }
    };
    reader.onerror = (e) => reject(e);
  });
}

// ==========================================
// タイマー
// ==========================================
function startTimer() {
  timerInterval = setInterval(() => {
    const elapsed = Date.now() - recordingStartTime;
    const minutes = Math.floor(elapsed / 60000);
    const seconds = Math.floor((elapsed % 60000) / 1000);

    timer.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

    // プログレスバー更新
    const progress = Math.min((elapsed / CONFIG.MAX_DURATION) * 100, 100);
    progressBar.style.width = `${progress}%`;

  }, 100);
}

// ==========================================
// UI更新
// ==========================================
function updateUI() {
  chunkCount.textContent = `${currentChunk} / ${CONFIG.MAX_CHUNKS}`;
  uploadCount.textContent = `${uploadedChunks} 完了`;
}

// ==========================================
// クリーンアップ
// ==========================================
function cleanup() {
  // タイマー停止
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }

  if (chunkInterval) {
    clearTimeout(chunkInterval);
    chunkInterval = null;
  }

  // ストリーム停止
  if (audioStream) {
    audioStream.getTracks().forEach(track => track.stop());
    audioStream = null;
  }

  // MediaRecorder解放
  if (mediaRecorder) {
    mediaRecorder = null;
  }

  // UI復元
  startBtn.classList.remove('hidden');
  stopBtn.classList.add('hidden');

  // 続きボタンを表示
  const continueBtn = document.getElementById('continueBtn');
  if (continueBtn) continueBtn.style.display = 'inline-block';

  statusText.textContent = '完了';

  log('🛑 録音停止・リソース解放完了');
}

// ... (ログ出力などは変更なし)

function saveSessionInfo() {
  const data = {
    id: sessionId,
    currentChunk: currentChunk + 1, // 次の開始番号
    updatedAt: Date.now()
  };
  localStorage.setItem('sns_rec_session', JSON.stringify(data));
}

// チャンク確定時に次回番号を更新
function updateSessionChunk() {
  const data = {
    id: sessionId,
    currentChunk: currentChunk + 1, // 現在の処理が終わったら次は+1
    updatedAt: Date.now()
  };
  localStorage.setItem('sns_rec_session', JSON.stringify(data));
}


// ==========================================
// ログ出力
// ==========================================
function log(message, type = 'info') {
  const now = new Date();
  const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

  const entry = document.createElement('div');
  entry.className = 'log-entry';
  entry.innerHTML = `<span class="log-time">[${timeStr}]</span>${message}`;

  logBox.appendChild(entry);
  logBox.scrollTop = logBox.scrollHeight;

  console.log(`[${timeStr}] ${message}`);
}

// ==========================================
// ユーティリティ
// ==========================================
function formatDate(date) {
  const year = String(date.getFullYear()).slice(-2);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}
