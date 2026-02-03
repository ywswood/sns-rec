/**
 * ========================================================================
 * 🟢 議事録＆企画書 自動生成スクリプト（完全版：メール送信付き・変数名重複対応）
 * 🟢 transcription.gs と共存可能
 * ========================================================================
 */

// ==========================================
// 設定 (MINUTES_CONFIG)
// ==========================================
// スクリプトプロパティから取得
const minutesProps = PropertiesService.getScriptProperties().getProperties();

const MINUTES_CONFIG = {
    BANK_URL: minutesProps.BANK_URL,
    BANK_PASS: minutesProps.BANK_PASS,
    PROJECT_NAME: minutesProps.PROJECT_NAME,
    TXT_FOLDER_ID: minutesProps.TXT_FOLDER_ID,
    DOC_FOLDER_ID: minutesProps.DOC_FOLDER_ID,
    ARCH_FOLDER_ID: minutesProps.ARCH_FOLDER_ID,
    VOICE_FOLDER_ID: minutesProps.VOICE_FOLDER_ID,
    NOTIFICATION_EMAIL: minutesProps.NOTIFICATION_EMAIL,
    SAMPLE_IMAGE_NAME: minutesProps.SAMPLE_IMAGE_NAME || 'sample_product.png',
    MAX_RETRIES: parseInt(minutesProps.MAX_RETRIES || '3', 10),
    RETRY_DELAY: parseInt(minutesProps.RETRY_DELAY || '2000', 10),
    API_TIMEOUT: parseInt(minutesProps.API_TIMEOUT || '300', 10)
};

// ==========================================
// プロンプト定義 (MINUTES_PROMPTS)
// ==========================================
const MINUTES_PROMPTS = {
    SNS_POST: `
以下の音声書き起こしテキストから、SNS（Twitter/X, Facebook, Instagram等）への投稿用テキストを複数パターン作成してください。

# 変換ルール
1.  **無駄な言葉の排除**: 「えー」「あのー」「そのー」などのフィラー、重複した表現、挨拶などを完全に取り除きます。
2.  **要約・構造化**: 内容の核心を抽出し、読者が一目で理解できるようにまとめます。
3.  **トーンの調整**: 親しみやすく、かつ知的な印象を与える自然な口調（SNSに適した表現）にします。
4.  **ハッシュタグの提案**: 投稿内容に関連する効果的なハッシュタグを3〜5個含めてください。

# 出力構成（以下の3つのパターンを作成）

## パターン1：要約・箇条書き（情報の網羅性重視）
- 内容を簡潔に箇条書きでまとめます。
- 結論から書き始めます。

## パターン2：ストーリー・共感型（エンゲージメント重視）
- 「気づき」や「学び」にフォーカスした語り口調にします。

## パターン3：短文・インパクト型（X/Twitter向け）
- 140文字以内で、最も伝えたい一言に凝縮します。

# 出力開始
余計な挨拶や前置きは一切不要です。
SNS投稿案_[ファイル名の日付_連番] から始めてください。
`
};

// ==========================================
// メイン処理（トリガー実行）
// ==========================================
// ==========================================
// Webアプリケーション (doPost) - 外部からの実行用
// ==========================================
function doPost(e) {
    try {
        const postData = JSON.parse(e.postData.contents);
        const action = postData.action;

        // 📥 音声アップロード処理 (action: 'upload_chunk')
        if (action === 'upload_chunk') {
            const fileName = postData.fileName;
            const fileData = postData.fileData; // Base64 string

            if (!fileName || !fileData) {
                throw new Error('Missing fileName or fileData');
            }

            const folder = DriveApp.getFolderById(MINUTES_CONFIG.VOICE_FOLDER_ID);
            const decodedData = Utilities.base64Decode(fileData);
            const blob = Utilities.newBlob(decodedData, 'audio/webm', fileName);

            const file = folder.createFile(blob);
            Logger.log(`✅ ファイル保存完了: ${fileName} (${file.getId()})`);

            return ContentService.createTextOutput(JSON.stringify({
                status: 'success',
                message: 'Upload successful',
                fileId: file.getId()
            })).setMimeType(ContentService.MimeType.JSON);
        }

        // 📑 投稿案生成リクエスト (action: 'create_report') または その他
        Logger.log("🌐 Webアプリ経由のリクエストを受信しました（非同期モード）");

        // 一回限りのトリガーを作成して即座に終了する
        ScriptApp.newTrigger('executeAsyncTasks')
            .timeBased()
            .after(1) // 1ミリ秒後（実質即時）
            .create();

        return ContentService.createTextOutput(JSON.stringify({
            status: 'success',
            message: 'Request accepted. Processing started in background.'
        })).setMimeType(ContentService.MimeType.JSON);

    } catch (error) {
        Logger.log(`❌ Webアプリ受付エラー: ${error.toString()}`);
        return ContentService.createTextOutput(JSON.stringify({
            status: 'error',
            message: error.toString()
        })).setMimeType(ContentService.MimeType.JSON);
    }
}

/**
 * 非同期実行用のラッパー関数
 * doPostからトリガー経由で呼び出される
 */
function executeAsyncTasks() {
    try {
        Logger.log("🚀 バックグラウンド処理を開始します");



        // 1. 音声ファイルの文字起こし実行 (transcription.jsの関数)
        if (typeof processVoiceFiles === 'function') {
            Logger.log("▶ processVoiceFiles() を実行します");
            processVoiceFiles();
        } else {
            Logger.log("⚠️ processVoiceFiles が見つかりません");
        }

        // 2. 書類生成の強制実行
        Logger.log("▶ processDocuments(true) を実行します");
        processDocuments(true);

        Logger.log("✅ バックグラウンド処理が完了しました");

    } catch (error) {
        Logger.log(`❌ バックグラウンド実行エラー: ${error.toString()}`);
        Logger.log(error.stack);
    }
}

// ==========================================
// 手動実行用 (待機時間を無視して強制実行)
// ==========================================
function manualRun() {
    processDocuments(true);
}

// ==========================================
// メイン処理（トリガー実行）
// force = true の場合は待機時間を無視
// ==========================================
function processDocuments(force = false) {
    try {
        Logger.log(`=== 書類生成処理を開始 (Force: ${force}) ===`);

        const txtFolder = DriveApp.getFolderById(MINUTES_CONFIG.TXT_FOLDER_ID);
        const docFolder = DriveApp.getFolderById(MINUTES_CONFIG.DOC_FOLDER_ID);
        const archFolder = DriveApp.getFolderById(MINUTES_CONFIG.ARCH_FOLDER_ID);
        const files = txtFolder.getFilesByType(MimeType.PLAIN_TEXT);

        let processedCount = 0;
        const STABILITY_THRESHOLD_MS = 20 * 60 * 1000; // 20分以内の更新は処理しない

        while (files.hasNext()) {
            const file = files.next();
            const fileName = file.getName(); // 例: 260201_150000.txt

            // 連番ファイル(_01) または タイムスタンプ(_162256) の両方を許可
            if (!fileName.match(/^\d{6}_(\d{2}|\d{6})\.txt$/)) continue;

            // 強制実行でない場合のみ、待機判定を行う
            if (!force) {
                const lastUpdated = file.getLastUpdated().getTime();
                const now = Date.now();

                if (now - lastUpdated < STABILITY_THRESHOLD_MS) {
                    Logger.log(`⏳ 待機中（更新直後）: ${fileName}`);
                    continue;
                }
            } else {
                Logger.log(`⚡ 強制実行: ${fileName}（待機時間をスキップします）`);
            }

            const baseName = fileName.replace('.txt', '');

            Logger.log(`📄 書類生成ターゲット検出: ${fileName}`);
            const textContent = file.getBlob().getDataAsString();
            let createdFiles = [];

            // 1. SNS投稿案作成
            const snsPostName = `【SNS投稿案】${baseName}`;
            if (docFolder.getFilesByName(snsPostName).hasNext()) {
                Logger.log(`⚠️ 既作成済みスキップ: ${snsPostName}`);
                // 既に作成済みなら、元ファイルはアーカイブへ移動（整理のため）
                try {
                    file.moveTo(archFolder);
                    Logger.log(`📦 (既済) アーカイブ移動完了: ${fileName}`);
                } catch (e) {
                    Logger.log(`⚠️ (既済) アーカイブ移動失敗: ${e.message}`);
                }
                continue;
            }

            const snsPostContent = callGeminiForMinutes(textContent, MINUTES_PROMPTS.SNS_POST);
            if (snsPostContent) {
                const docFile = createMinutesDoc(docFolder, snsPostName, snsPostContent);
                createdFiles.push(docFile);
                Logger.log(`✅ SNS投稿案作成完了: ${snsPostName}`);
            }

            // 3. メール送信
            if (createdFiles.length > 0) {
                sendNotificationEmail(baseName, createdFiles, snsPostContent);

                // 4. 元ファイルをアーカイブへ移動（成功時のみ）
                try {
                    file.moveTo(archFolder);
                    Logger.log(`📦 アーカイブ移動完了: ${fileName}`);
                } catch (e) {
                    Logger.log(`⚠️ アーカイブ移動失敗: ${e.message}`);
                }
            }

            processedCount++;
        }

        Logger.log(`=== 処理完了: ${processedCount}件のファイルを処理 ===`);

    } catch (error) {
        Logger.log(`❌ メイン処理エラー: ${error.message}`);
        Logger.log(error.stack);
    }
}

// ==========================================
// Googleドキュメント作成
// ==========================================
function createMinutesDoc(folder, title, content, imageBlob = null) {
    const doc = DocumentApp.create(title);
    const body = doc.getBody();

    body.setText(content);

    // 画像がある場合
    if (imageBlob) {
        try {
            body.insertParagraph(0, "");
            const image = body.insertImage(1, imageBlob);

            // 修正: getHeightを使わず幅のみ指定
            const originalWidth = image.getWidth();
            if (originalWidth > 400) {
                image.setWidth(400);
                // 高さは自動
            }
        } catch (e) {
            Logger.log(`⚠️ 画像挿入中にエラー(スキップしました): ${e.message}`);
        }
    }

    doc.saveAndClose();

    // フォルダ移動とファイル取得
    const docFile = DriveApp.getFileById(doc.getId());
    docFile.moveTo(folder);

    return docFile;
}

// ==========================================
// メール送信
// ==========================================
function sendNotificationEmail(baseName, files, minutesContent = null) {
    const subject = `【SNS投稿案生成】${baseName}`;
    let body = `音声の自動文字起こしから、以下のSNS投稿案を生成しました。\n\n`;
    const attachments = [];

    files.forEach(file => {
        body += `・${file.getName()}\n${file.getUrl()}\n`;
        attachments.push(file.getAs(MimeType.PDF));
    });

    // 議事録内容をメール本文に追加
    if (minutesContent) {
        body += `\n${'='.repeat(50)}\n`;
        body += `📋 SNS投稿案（クイックビュー）\n`;
        body += `${'='.repeat(50)}\n\n`;
        body += minutesContent;
        body += `\n\n${'='.repeat(50)}\n`;
    }

    body += `\n以上のファイルをPDFとして添付しました。ご確認ください。\n`;
    body += `\n--\nSNS-Rec Bot`;

    MailApp.sendEmail({
        to: MINUTES_CONFIG.NOTIFICATION_EMAIL,
        subject: subject,
        body: body,
        attachments: attachments
    });

    Logger.log(`📧 メール送信完了: ${MINUTES_CONFIG.NOTIFICATION_EMAIL}`);
}

// ==========================================
// 画像検索
// ==========================================
function findSampleImage() {
    try {
        const foldersToCheck = [MINUTES_CONFIG.VOICE_FOLDER_ID, MINUTES_CONFIG.TXT_FOLDER_ID];

        for (const folderId of foldersToCheck) {
            const folder = DriveApp.getFolderById(folderId);
            const files = folder.getFilesByName(MINUTES_CONFIG.SAMPLE_IMAGE_NAME);
            if (files.hasNext()) {
                return files.next().getBlob();
            }
        }
        return null;
    } catch (e) {
        return null;
    }
}

// ==========================================
// Gemini API 呼び出し
// ==========================================
function callGeminiForMinutes(text, systemPrompt) {
    let previousModel = null;

    for (let attempt = 1; attempt <= MINUTES_CONFIG.MAX_RETRIES; attempt++) {
        try {
            let bankUrl = `${MINUTES_CONFIG.BANK_URL}?pass=${MINUTES_CONFIG.BANK_PASS}&project=${MINUTES_CONFIG.PROJECT_NAME}`;
            if (previousModel) {
                bankUrl += `&error_503=true&previous_model=${encodeURIComponent(previousModel)}`;
            }

            const bankRes = UrlFetchApp.fetch(bankUrl, { muteHttpExceptions: true });
            const bankData = JSON.parse(bankRes.getContentText());

            if (bankData.status !== 'success') {
                throw new Error(bankData.message);
            }

            const { api_key, model_name } = bankData;
            const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model_name}:generateContent?key=${api_key}`;

            const payload = {
                contents: [{
                    parts: [{ text: systemPrompt + "\n\n【書き起こしテキスト】\n" + text }]
                }]
            };

            const geminiRes = UrlFetchApp.fetch(apiUrl, {
                method: 'post',
                contentType: 'application/json',
                payload: JSON.stringify(payload),
                muteHttpExceptions: true,
                timeout: MINUTES_CONFIG.API_TIMEOUT
            });

            const statusCode = geminiRes.getResponseCode();

            if (statusCode === 503) {
                previousModel = model_name;
                Utilities.sleep(MINUTES_CONFIG.RETRY_DELAY);
                continue;
            }

            const geminiData = JSON.parse(geminiRes.getContentText());

            if (geminiData.error) {
                throw new Error(JSON.stringify(geminiData.error));
            }

            return geminiData.candidates[0].content.parts[0].text;

        } catch (error) {
            Logger.log(`❌ Gemini呼び出しエラー(試行${attempt}): ${error.message}`);
            if (attempt === MINUTES_CONFIG.MAX_RETRIES) return null;
            Utilities.sleep(MINUTES_CONFIG.RETRY_DELAY);
        }
    }
    return null;
}

