/**
 * ========================================================================
 * 🟢 GAS用コード (transcription.js) - 追記集約版
 * ========================================================================
 */

// ==========================================
// 設定
// ==========================================
const transcribeProps = PropertiesService.getScriptProperties().getProperties();

const CONFIG = {
  BANK_URL: transcribeProps.BANK_URL,
  BANK_PASS: transcribeProps.BANK_PASS,
  PROJECT_NAME: transcribeProps.PROJECT_NAME,
  TXT_FOLDER_ID: transcribeProps.TXT_FOLDER_ID,
  ARCH_FOLDER_ID: transcribeProps.ARCH_FOLDER_ID,
  VOICE_FOLDER_ID: transcribeProps.VOICE_FOLDER_ID,
  MAX_RETRIES: parseInt(transcribeProps.MAX_RETRIES || '3', 10),
  RETRY_DELAY: parseInt(transcribeProps.RETRY_DELAY || '2000', 10),
  API_TIMEOUT: parseInt(transcribeProps.API_TIMEOUT || '300', 10)
};

// ==========================================
// メイン処理（トリガー実行: 1分ごと）
// ==========================================
function processVoiceFiles() {
  const voiceFolder = DriveApp.getFolderById(CONFIG.VOICE_FOLDER_ID);
  const files = voiceFolder.getFiles();

  Logger.log('=== 処理開始: 音声ファイルスキャン ===');
  let count = 0;

  while (files.hasNext()) {
    const file = files.next();
    const fileName = file.getName();

    // 処理対象: .webmのみ
    if (fileName.endsWith('.webm')) {
      try {
        Logger.log(`🎤 処理開始: ${fileName}`);

        // 文字起こし実行
        const text = transcribeAudio(file);

        if (text) {
          // テキスト保存（追記モード）
          saveTextToSessionFile(fileName, text);

          // 元ファイル削除
          file.setTrashed(true);
          Logger.log(`🗑️ 元ファイル削除: ${fileName}`);
          count++;
        }
      } catch (e) {
        Logger.log(`❌ エラー (${fileName}): ${e.message}`);
      }
    }
  }

  Logger.log(`=== 処理完了: ${count}件 ===`);
}

// ==========================================
// 文字起こし関数
// ==========================================
function transcribeAudio(file) {
  const blob = file.getBlob();
  // ... (ここは既存ロジックと同じ、api_bank呼び出し)
  // 長くなるので既存のtranscribeAudio関数の内容をここに想定
  // 下記の既存実装をそのまま利用するために、ここでは簡略化せずフルのコードが必要
  // しかし、今回の変更点は「保存ロジック」だけなので、transcribeAudioはそのまま流用可能

  // ※実際のGASへコピペする際は、元のtranscribeAudio関数を含めてください
  return callApiBankTranscription(blob, file.getMimeType());
}

// 実際のAPI呼び出し部分（元のコードから抽出・整理）
function callApiBankTranscription(blob, mimeType) {
  let previousModel = null;

  for (let attempt = 1; attempt <= CONFIG.MAX_RETRIES; attempt++) {
    try {
      // APIキー取得
      let bankUrl = `${CONFIG.BANK_URL}?pass=${CONFIG.BANK_PASS}&project=${CONFIG.PROJECT_NAME}&type=stt`;
      if (previousModel) {
        bankUrl += `&error_503=true&previous_model=${encodeURIComponent(previousModel)}`;
      }

      const bankRes = UrlFetchApp.fetch(bankUrl, { muteHttpExceptions: true });
      const bankData = JSON.parse(bankRes.getContentText());

      if (bankData.status !== 'success') {
        reportError('INITIAL_FETCH_FAILED');
        throw new Error(bankData.message);
      }

      const { api_key, model_name } = bankData;

      // Gemini呼び出し
      const base64Audio = Utilities.base64Encode(blob.getBytes());
      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model_name}:generateContent?key=${api_key}`;

      const payload = {
        contents: [{
          parts: [
            { text: "音声を書き起こしてください。フィラー（えー、あー）は取り除いてください。" },
            { inline_data: { mime_type: mimeType, data: base64Audio } }
          ]
        }]
      };

      const geminiRes = UrlFetchApp.fetch(apiUrl, {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify(payload),
        muteHttpExceptions: true,
        timeout: CONFIG.API_TIMEOUT
      });

      const statusCode = geminiRes.getResponseCode();

      if (statusCode === 503) {
        previousModel = model_name;
        Utilities.sleep(CONFIG.RETRY_DELAY);
        continue;
      }

      const geminiData = JSON.parse(geminiRes.getContentText());
      if (geminiData.error) {
        reportError(api_key);
        throw new Error(JSON.stringify(geminiData.error));
      }

      return geminiData.candidates[0].content.parts[0].text;

    } catch (error) {
      Logger.log(`❌ リトライ待機: ${error.message}`);
      if (attempt === CONFIG.MAX_RETRIES) throw error;
      Utilities.sleep(CONFIG.RETRY_DELAY);
    }
  }
}

// ==========================================
// [変更点] セッションファイルへの保存（追記）
// ==========================================
function saveTextToSessionFile(originalFileName, text) {
  const txtFolder = DriveApp.getFolderById(CONFIG.TXT_FOLDER_ID);
  const archFolder = DriveApp.getFolderById(CONFIG.ARCH_FOLDER_ID); // 設定から取得

  // 1. SessionIDの特定（アプリ側のID: YYMMDD_HHmmss）
  // ファイル名: 260202_130000_chunk01.webm -> 260202_130000
  const sessionMatch = originalFileName.match(/^(\d{6}_\d{6})_chunk\d{2}\.webm$/);
  const rawSessionId = sessionMatch ? sessionMatch[1] : originalFileName.replace('.webm', '');

  // 2. 連番ネーミングの決定 (ScriptPropertiesでマッピング管理)
  const props = PropertiesService.getScriptProperties();
  let targetFileName = props.getProperty(rawSessionId); // 既にあれば取得 (例: 260202_01.txt)

  // まだマッピングが無い場合（新規セッション）
  if (!targetFileName) {
    const todayPrefix = rawSessionId.substring(0, 6); // YYMMDD

    // 既存ファイルの連番最大値を検索 (TXTフォルダとARCHフォルダ両方)
    let maxNum = 0;

    const checkFolder = (folder) => {
      const files = folder.getFiles();
      while (files.hasNext()) {
        const f = files.next();
        // マッチ: YYMMDD_XX.txt
        const m = f.getName().match(new RegExp(`^${todayPrefix}_(\\d{2})\\.txt$`));
        if (m) {
          const num = parseInt(m[1], 10);
          if (num > maxNum) maxNum = num;
        }
      }
    };

    checkFolder(txtFolder);
    checkFolder(archFolder);

    // 新しい連番
    const nextNum = String(maxNum + 1).padStart(2, '0');
    targetFileName = `${todayPrefix}_${nextNum}.txt`;

    // マッピング保存 (このセッションIDはずっとこのファイル名を使う)
    props.setProperty(rawSessionId, targetFileName);
    Logger.log(`🆕 新規連番割り当て: ${rawSessionId} -> ${targetFileName}`);
  }

  // チャンク番号取得
  const chunkMatch = originalFileName.match(/_chunk(\d{2})\.webm$/);
  const chunkNum = chunkMatch ? chunkMatch[1] : '00';

  const appendContent = `\n\n--- Chunk ${chunkNum} (${new Date().toLocaleTimeString()}) ---\n${text}`;

  // 3. ファイルへの書き込み
  // ターゲットファイルを探す
  const existingFiles = txtFolder.getFilesByName(targetFileName);

  if (existingFiles.hasNext()) {
    // 追記
    const file = existingFiles.next();
    const currentContent = file.getBlob().getDataAsString();
    file.setContent(currentContent + appendContent);
    Logger.log(`📝 既存ファイルに追記: ${targetFileName}`);
  } else {
    // 新規作成
    const header = `=== 商談記録 ===\nOriginal Session: ${rawSessionId}\nFile Name: ${targetFileName}\n作成開始: ${new Date().toLocaleString()}\n`;
    txtFolder.createFile(targetFileName, header + appendContent, MimeType.PLAIN_TEXT);
    Logger.log(`🆕 新規セッションファイル作成: ${targetFileName}`);
  }
}

// ==========================================
// エラー報告
// ==========================================
function reportError(api_key) {
  try {
    UrlFetchApp.fetch(CONFIG.BANK_URL, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ pass: CONFIG.BANK_PASS, api_key: api_key }),
      muteHttpExceptions: true
    });
  } catch (e) { }
}