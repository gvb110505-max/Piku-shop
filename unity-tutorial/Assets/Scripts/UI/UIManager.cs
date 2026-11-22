using System;
using System.Collections;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;

/// <summary>
/// 모든 UI를 코드로 생성/관리한다 (씬에 별도 Canvas 설정 불필요).
///  상단: 목표 / 좌상단: 코인·소지품·물 게이지 / 우상단: 해 뜨기 타이머
///  하단: 상호작용 프롬프트·대사창 / 위험 시: 열기 게이지 + 생존 카운트다운 + 붉은 비네트
/// 나중에 디자인된 UI 프리팹으로 바꿀 때는 이 클래스의 public 메서드(ShowPrompt, ShowDialog 등)만 유지하면 된다.
/// </summary>
public class UIManager : MonoBehaviour
{
    public static UIManager Instance { get; private set; }

    [Header("타이머 연출")]
    [SerializeField] Color timerNormalColor = Color.white;
    [SerializeField] Color timerWarningColor = new Color(1f, 0.25f, 0.2f);
    [SerializeField] float blinkSpeed = 4f;

    [Header("열기 연출")]
    [SerializeField] Color vignetteColor = new Color(0.85f, 0.05f, 0.02f);
    [SerializeField, Range(0f, 1f)] float vignetteMaxAlpha = 0.9f;
    [SerializeField, Range(0f, 1f)] float heatTintMaxAlpha = 0.25f;

    Font font;

    Text objectiveText, coinText, inventoryText, waterLabel;
    Text timerText, warningText, promptText, bannerText, toastText, survivalText;
    Text dialogSpeaker, dialogBody, dialogHint;
    RectTransform waterFill, heatFill;
    GameObject objectiveBg, waterGroup, heatGroup, bannerBg, toastBg, dialogPanel, gameOverPanel, successPanel;
    Image fadeImage, vignetteImage, tintImage;
    readonly Button[] choiceButtons = new Button[3];
    readonly Text[] choiceLabels = new Text[3];
    Coroutine bannerRoutine, toastRoutine;

    // 대사창 상태
    bool dialogOpen;
    string[] dialogLines;
    string[] dialogChoices;
    int lineIndex;
    bool showingChoices;
    Action<int> dialogCallback;
    int dialogOpenFrame;

    // 소지품 표시 캐시 (바뀔 때만 문자열 갱신)
    int lastCoins = -1;
    bool lastSeed;
    float lastWater = -1f;
    bool waterShown;

    void Awake()
    {
        Instance = this;
        font = FontProvider.Get();
        BuildUI();
    }

    void Start()
    {
        if (EventSystem.current == null)
        {
            var es = new GameObject("EventSystem");
            es.AddComponent<EventSystem>();
            es.AddComponent<StandaloneInputModule>();
        }
    }

    // =====================================================================
    //  공개 API
    // =====================================================================

    public void SetObjective(string text)
    {
        objectiveText.text = text;
        objectiveBg.SetActive(!string.IsNullOrEmpty(text));
    }

    public void ShowPrompt(string text)
    {
        if (dialogOpen) return;
        promptText.text = text;
        promptText.gameObject.SetActive(true);
    }

    public void HidePrompt() => promptText.gameObject.SetActive(false);

    /// <summary>화면 중앙 하단의 큰 안내문 (열기 경고 등).</summary>
    public void ShowBanner(string text, float seconds)
    {
        if (bannerRoutine != null) StopCoroutine(bannerRoutine);
        bannerRoutine = StartCoroutine(TimedShow(bannerBg, bannerText, text, seconds));
    }

    /// <summary>상단 작은 알림.</summary>
    public void ShowToast(string text, float seconds = 2.5f)
    {
        if (toastRoutine != null) StopCoroutine(toastRoutine);
        toastRoutine = StartCoroutine(TimedShow(toastBg, toastText, text, seconds));
    }

    /// <summary>
    /// 대사창. lines를 E로 넘기고, choices가 있으면 마지막에 선택지(1~3키 또는 클릭)를 보여준다.
    /// onClosed에는 선택 인덱스(선택지 없으면 -1)가 전달된다.
    /// </summary>
    public void ShowDialog(string speaker, string[] lines, string[] choices, Action<int> onClosed)
    {
        if (dialogOpen) return;

        dialogOpen = true;
        dialogOpenFrame = Time.frameCount;
        dialogLines = lines;
        dialogChoices = choices;
        dialogCallback = onClosed;
        lineIndex = 0;
        showingChoices = false;

        dialogSpeaker.text = speaker;
        dialogPanel.SetActive(true);
        HidePrompt();
        RefreshDialog();

        GameManager.Instance.Player.SetControl(false);
        SetCursorFree(true);
    }

    public IEnumerator Fade(Color color, float from, float to, float duration)
    {
        fadeImage.gameObject.SetActive(true);
        float t = 0f;
        while (t < duration)
        {
            t += Time.unscaledDeltaTime;
            float a = Mathf.Lerp(from, to, Mathf.Clamp01(t / duration));
            fadeImage.color = new Color(color.r, color.g, color.b, a);
            yield return null;
        }
        fadeImage.color = new Color(color.r, color.g, color.b, to);
        if (to <= 0.001f) fadeImage.gameObject.SetActive(false);
    }

    public void ShowGameOver()
    {
        HidePrompt();
        gameOverPanel.SetActive(true);
        SetCursorFree(true);
    }

    public void ShowSuccess()
    {
        HidePrompt();
        successPanel.SetActive(true);
        SetCursorFree(true);
    }

    public void SetCursorFree(bool free)
    {
        Cursor.lockState = free ? CursorLockMode.None : CursorLockMode.Locked;
        Cursor.visible = free;
    }

    // =====================================================================
    //  매 프레임 갱신
    // =====================================================================

    void Update()
    {
        var gm = GameManager.Instance;
        if (gm == null) return;

        // 에디터에서 Esc로 풀린 마우스를 클릭으로 다시 고정
        if (gm.State == GameState.Playing && !dialogOpen && Cursor.lockState != CursorLockMode.Locked
            && Input.GetMouseButtonDown(0))
            SetCursorFree(false);

        UpdateInventory(gm);
        UpdateTimer();
        UpdateHeat();
        UpdateDialogInput();
    }

    void UpdateInventory(GameManager gm)
    {
        if (gm.Coins != lastCoins)
        {
            lastCoins = gm.Coins;
            coinText.text = $"코인  {gm.Coins}";
        }

        if (gm.HasSeed != lastSeed || lastWater < 0f || !Mathf.Approximately(gm.Water, lastWater))
        {
            lastSeed = gm.HasSeed;
            lastWater = gm.Water;
            if (gm.Water > 0f) waterShown = true;

            string water = waterShown ? $"물 {gm.Water:0.00}L" : "물 -";
            inventoryText.text = $"소지품:  씨앗 {(gm.HasSeed ? "1" : "-")}   {water}";

            waterGroup.SetActive(waterShown);
            waterFill.anchorMax = new Vector2(Mathf.Clamp01(gm.Water / gm.WaterCapacity), 1f);
            waterLabel.text = $"{gm.Water:0.00} / {gm.WaterCapacity:0.00} L";
        }
    }

    void UpdateTimer()
    {
        var dt = DayTimer.Instance;
        bool active = dt != null && (dt.IsRunning || dt.IsExpired);
        timerText.gameObject.SetActive(active);
        if (!active)
        {
            warningText.gameObject.SetActive(false);
            return;
        }

        if (dt.IsExpired)
        {
            timerText.text = "해가 떴다!";
            timerText.color = timerWarningColor;
            warningText.gameObject.SetActive(false);
            return;
        }

        int sec = Mathf.CeilToInt(dt.Remaining);
        timerText.text = $"해 뜨기까지  {sec / 60}:{sec % 60:00}";

        bool warn = dt.Remaining <= dt.WarningTime;
        float blink = warn ? (Mathf.Sin(Time.unscaledTime * blinkSpeed * Mathf.PI) * 0.5f + 0.5f) : 0f;
        timerText.color = Color.Lerp(timerNormalColor, timerWarningColor, blink);

        warningText.gameObject.SetActive(warn);
        if (warn)
        {
            var c = timerWarningColor;
            c.a = 0.35f + 0.65f * blink;
            warningText.color = c;
        }
    }

    void UpdateHeat()
    {
        var hs = HeatSystem.Instance;
        float h = hs != null ? hs.Heat01 : 0f;

        float pulse = 0.85f + 0.15f * Mathf.Sin(Time.unscaledTime * 8f);
        var v = vignetteColor;
        v.a = h * vignetteMaxAlpha * pulse;
        vignetteImage.color = v;

        var t = tintImage.color;
        t.a = h * heatTintMaxAlpha;
        tintImage.color = t;

        bool show = h > 0.001f;
        heatGroup.SetActive(show);
        if (show)
        {
            survivalText.text = $"열기! 생존 시간  {hs.SurvivalRemaining:0.0}초";
            heatFill.anchorMax = new Vector2(h, 1f);
        }
    }

    void UpdateDialogInput()
    {
        if (!dialogOpen || Time.frameCount == dialogOpenFrame) return;

        if (showingChoices)
        {
            for (int i = 0; i < dialogChoices.Length && i < 3; i++)
                if (Input.GetKeyDown(KeyCode.Alpha1 + i) || Input.GetKeyDown(KeyCode.Keypad1 + i))
                {
                    PickChoice(i);
                    return;
                }
        }
        else if (Input.GetKeyDown(KeyCode.E) || Input.GetKeyDown(KeyCode.Return) || Input.GetKeyDown(KeyCode.Space))
        {
            lineIndex++;
            if (lineIndex < dialogLines.Length) RefreshDialog();
            else if (dialogChoices != null && dialogChoices.Length > 0)
            {
                showingChoices = true;
                RefreshDialog();
            }
            else CloseDialog(-1);
        }
    }

    void RefreshDialog()
    {
        if (showingChoices)
        {
            dialogHint.text = "숫자키 또는 클릭으로 선택";
            for (int i = 0; i < 3; i++)
            {
                bool has = i < dialogChoices.Length;
                choiceButtons[i].gameObject.SetActive(has);
                if (has) choiceLabels[i].text = $"[{i + 1}] {dialogChoices[i]}";
            }
        }
        else
        {
            dialogBody.text = dialogLines[Mathf.Min(lineIndex, dialogLines.Length - 1)];
            dialogHint.text = "E: 계속";
            for (int i = 0; i < 3; i++) choiceButtons[i].gameObject.SetActive(false);
        }
    }

    void PickChoice(int index) => CloseDialog(index);

    void CloseDialog(int choice)
    {
        dialogOpen = false;
        dialogPanel.SetActive(false);

        var gm = GameManager.Instance;
        if (gm.State == GameState.Playing)
        {
            gm.Player.SetControl(true);
            SetCursorFree(false);
        }

        var cb = dialogCallback;
        dialogCallback = null;
        cb?.Invoke(choice);
    }

    IEnumerator TimedShow(GameObject bg, Text label, string text, float seconds)
    {
        label.text = text;
        bg.SetActive(true);
        yield return new WaitForSeconds(seconds);
        bg.SetActive(false);
    }

    // =====================================================================
    //  UI 생성
    // =====================================================================

    void BuildUI()
    {
        var canvasGo = new GameObject("UICanvas");
        canvasGo.transform.SetParent(transform, false);
        var canvas = canvasGo.AddComponent<Canvas>();
        canvas.renderMode = RenderMode.ScreenSpaceOverlay;
        canvas.sortingOrder = 10;
        var scaler = canvasGo.AddComponent<CanvasScaler>();
        scaler.uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
        scaler.referenceResolution = new Vector2(1920f, 1080f);
        scaler.matchWidthOrHeight = 0.5f;
        canvasGo.AddComponent<GraphicRaycaster>();
        Transform root = canvas.transform;

        // --- 열기 화면 효과 (맨 아래 레이어) ---
        vignetteImage = MakeFull(root, "HeatVignette", new Color(vignetteColor.r, vignetteColor.g, vignetteColor.b, 0f), MakeVignetteSprite());
        tintImage = MakeFull(root, "HeatTint", new Color(1f, 0.45f, 0.1f, 0f), null);

        // --- 상단: 목표 ---
        var objBg = MakeImage(root, "ObjectiveBg", new Color(0f, 0f, 0f, 0.45f), new Vector2(0.5f, 1f), new Vector2(0.5f, 1f), new Vector2(0f, -24f), new Vector2(1100f, 70f));
        objectiveBg = objBg.gameObject;
        objectiveText = MakeText(objBg.transform, "Objective", 38, TextAnchor.MiddleCenter, Center, Center, Vector2.zero, new Vector2(1060f, 66f));
        objectiveBg.SetActive(false);

        // --- 좌상단: 코인 / 소지품 / 물 게이지 ---
        coinText = MakeText(root, "Coins", 40, TextAnchor.UpperLeft, TopLeft, TopLeft, new Vector2(30f, -30f), new Vector2(500f, 50f));
        inventoryText = MakeText(root, "Inventory", 32, TextAnchor.UpperLeft, TopLeft, TopLeft, new Vector2(30f, -82f), new Vector2(700f, 44f));

        var waterBg = MakeImage(root, "WaterGauge", new Color(0f, 0f, 0f, 0.55f), TopLeft, TopLeft, new Vector2(30f, -132f), new Vector2(340f, 36f));
        waterGroup = waterBg.gameObject;
        waterFill = MakeFillBar(waterBg.transform, new Color(0.35f, 0.75f, 1f, 0.95f));
        waterLabel = MakeText(waterBg.transform, "WaterLabel", 24, TextAnchor.MiddleCenter, Center, Center, Vector2.zero, new Vector2(340f, 36f));
        waterGroup.SetActive(false);

        // --- 우상단: 타이머 ---
        timerText = MakeText(root, "Timer", 44, TextAnchor.UpperRight, TopRight, TopRight, new Vector2(-30f, -30f), new Vector2(600f, 60f));
        warningText = MakeText(root, "SunWarning", 34, TextAnchor.UpperRight, TopRight, TopRight, new Vector2(-30f, -92f), new Vector2(800f, 50f));
        warningText.text = "곧 해가 뜬다! 안전한 곳으로!";
        timerText.gameObject.SetActive(false);
        warningText.gameObject.SetActive(false);

        // --- 열기 게이지 + 생존 카운트다운 (상단 중앙 아래) ---
        var heatBg = MakeImage(root, "HeatGauge", new Color(0f, 0f, 0f, 0.6f), TopCenter, TopCenter, new Vector2(0f, -205f), new Vector2(620f, 30f));
        heatGroup = heatBg.gameObject;
        heatFill = MakeFillBar(heatBg.transform, new Color(1f, 0.2f, 0.1f, 0.95f));
        survivalText = MakeText(heatBg.transform, "Survival", 52, TextAnchor.MiddleCenter, TopCenter, TopCenter, new Vector2(0f, 75f), new Vector2(900f, 70f));
        survivalText.color = new Color(1f, 0.3f, 0.2f);
        heatGroup.SetActive(false);

        // --- 토스트 / 배너 ---
        var toastImg = MakeImage(root, "ToastBg", new Color(0f, 0f, 0f, 0.55f), TopCenter, TopCenter, new Vector2(0f, -110f), new Vector2(900f, 56f));
        toastBg = toastImg.gameObject;
        toastText = MakeText(toastImg.transform, "Toast", 30, TextAnchor.MiddleCenter, Center, Center, Vector2.zero, new Vector2(880f, 52f));
        toastBg.SetActive(false);

        var bannerImg = MakeImage(root, "BannerBg", new Color(0.25f, 0.04f, 0.02f, 0.82f), Center, Center, new Vector2(0f, 120f), new Vector2(1300f, 190f));
        bannerBg = bannerImg.gameObject;
        bannerText = MakeText(bannerImg.transform, "Banner", 38, TextAnchor.MiddleCenter, Center, Center, Vector2.zero, new Vector2(1240f, 170f));
        bannerBg.SetActive(false);

        // --- 하단: 프롬프트 ---
        promptText = MakeText(root, "Prompt", 38, TextAnchor.MiddleCenter, BottomCenter, BottomCenter, new Vector2(0f, 150f), new Vector2(1000f, 60f));
        promptText.gameObject.SetActive(false);

        // --- 하단: 대사창 ---
        var dlg = MakeImage(root, "Dialog", new Color(0f, 0f, 0f, 0.78f), BottomCenter, BottomCenter, new Vector2(0f, 40f), new Vector2(1400f, 300f));
        dlg.raycastTarget = true;
        dialogPanel = dlg.gameObject;
        dialogSpeaker = MakeText(dlg.transform, "Speaker", 36, TextAnchor.UpperLeft, TopLeft, TopLeft, new Vector2(30f, -20f), new Vector2(600f, 50f));
        dialogSpeaker.color = new Color(1f, 0.85f, 0.35f);
        dialogBody = MakeText(dlg.transform, "Body", 34, TextAnchor.UpperLeft, TopLeft, TopLeft, new Vector2(30f, -80f), new Vector2(1340f, 120f));
        dialogHint = MakeText(dlg.transform, "Hint", 26, TextAnchor.LowerRight, BottomRight, BottomRight, new Vector2(-30f, 14f), new Vector2(500f, 40f));
        dialogHint.color = new Color(0.75f, 0.75f, 0.75f);
        for (int i = 0; i < 3; i++)
        {
            int index = i;
            var b = MakeButton(dlg.transform, $"Choice{i + 1}", BottomLeft, BottomLeft, new Vector2(30f + i * 460f, 20f), new Vector2(440f, 64f), out choiceLabels[i]);
            b.onClick.AddListener(() => { if (dialogOpen && showingChoices) PickChoice(index); });
            choiceButtons[i] = b;
        }
        dialogPanel.SetActive(false);

        // --- 페이드 (시작 시 검정으로 가득) ---
        fadeImage = MakeFull(root, "Fade", Color.black, null);
        fadeImage.raycastTarget = false;

        // --- 결과 화면 ---
        gameOverPanel = BuildResultPanel(root, "GameOver", new Color(0.3f, 0.02f, 0.02f, 0.88f),
            "열기에 쓰러졌다", "해가 뜨기 전에 안전한 곳으로 피해야 했다...", "다시 시작");
        successPanel = BuildResultPanel(root, "Success", new Color(0.02f, 0.12f, 0.16f, 0.88f),
            "임시거처에 도착했다", "튜토리얼 종료", "처음부터 다시");
    }

    GameObject BuildResultPanel(Transform root, string name, Color bg, string title, string sub, string buttonText)
    {
        var panel = MakeFull(root, name, bg, null);
        panel.raycastTarget = true; // 뒤쪽 클릭 차단

        var t = MakeText(panel.transform, "Title", 90, TextAnchor.MiddleCenter, Center, Center, new Vector2(0f, 130f), new Vector2(1400f, 130f));
        t.text = title;
        var s = MakeText(panel.transform, "Sub", 40, TextAnchor.MiddleCenter, Center, Center, new Vector2(0f, 30f), new Vector2(1400f, 70f));
        s.text = sub;
        s.color = new Color(0.85f, 0.85f, 0.85f);

        var b = MakeButton(panel.transform, "RestartButton", Center, Center, new Vector2(0f, -100f), new Vector2(420f, 90f), out Text label);
        label.text = buttonText;
        label.fontSize = 36;
        b.onClick.AddListener(() => GameManager.Instance.Restart());

        panel.gameObject.SetActive(false);
        return panel.gameObject;
    }

    // ---------- UI 헬퍼 ----------
    static readonly Vector2 Center = new Vector2(0.5f, 0.5f);
    static readonly Vector2 TopLeft = new Vector2(0f, 1f);
    static readonly Vector2 TopCenter = new Vector2(0.5f, 1f);
    static readonly Vector2 TopRight = new Vector2(1f, 1f);
    static readonly Vector2 BottomLeft = new Vector2(0f, 0f);
    static readonly Vector2 BottomCenter = new Vector2(0.5f, 0f);
    static readonly Vector2 BottomRight = new Vector2(1f, 0f);

    static RectTransform NewRect(string name, Transform parent)
    {
        var go = new GameObject(name, typeof(RectTransform));
        var rt = (RectTransform)go.transform;
        rt.SetParent(parent, false);
        return rt;
    }

    static void Place(RectTransform rt, Vector2 anchor, Vector2 pivot, Vector2 pos, Vector2 size)
    {
        rt.anchorMin = anchor;
        rt.anchorMax = anchor;
        rt.pivot = pivot;
        rt.anchoredPosition = pos;
        rt.sizeDelta = size;
    }

    static Image MakeImage(Transform parent, string name, Color color, Vector2 anchor, Vector2 pivot, Vector2 pos, Vector2 size)
    {
        var rt = NewRect(name, parent);
        Place(rt, anchor, pivot, pos, size);
        var img = rt.gameObject.AddComponent<Image>();
        img.color = color;
        img.raycastTarget = false;
        return img;
    }

    static Image MakeFull(Transform parent, string name, Color color, Sprite sprite)
    {
        var rt = NewRect(name, parent);
        rt.anchorMin = Vector2.zero;
        rt.anchorMax = Vector2.one;
        rt.offsetMin = Vector2.zero;
        rt.offsetMax = Vector2.zero;
        var img = rt.gameObject.AddComponent<Image>();
        img.sprite = sprite;
        img.color = color;
        img.raycastTarget = false;
        return img;
    }

    /// <summary>부모를 꽉 채우는 막대. anchorMax.x를 0~1로 바꿔 게이지로 쓴다.</summary>
    static RectTransform MakeFillBar(Transform parent, Color color)
    {
        var rt = NewRect("Fill", parent);
        rt.anchorMin = Vector2.zero;
        rt.anchorMax = new Vector2(0f, 1f);
        rt.pivot = new Vector2(0f, 0.5f);
        rt.offsetMin = Vector2.zero;
        rt.offsetMax = Vector2.zero;
        var img = rt.gameObject.AddComponent<Image>();
        img.color = color;
        img.raycastTarget = false;
        return rt;
    }

    Text MakeText(Transform parent, string name, int size, TextAnchor align, Vector2 anchor, Vector2 pivot, Vector2 pos, Vector2 boxSize)
    {
        var rt = NewRect(name, parent);
        Place(rt, anchor, pivot, pos, boxSize);
        var t = rt.gameObject.AddComponent<Text>();
        t.font = font;
        t.fontSize = size;
        t.alignment = align;
        t.color = Color.white;
        t.raycastTarget = false;
        t.horizontalOverflow = HorizontalWrapMode.Wrap;
        t.verticalOverflow = VerticalWrapMode.Overflow;
        var shadow = rt.gameObject.AddComponent<Shadow>();
        shadow.effectColor = new Color(0f, 0f, 0f, 0.85f);
        shadow.effectDistance = new Vector2(2f, -2f);
        return t;
    }

    Button MakeButton(Transform parent, string name, Vector2 anchor, Vector2 pivot, Vector2 pos, Vector2 size, out Text label)
    {
        var img = MakeImage(parent, name, new Color(0.45f, 0.52f, 0.68f, 1f), anchor, pivot, pos, size);
        img.raycastTarget = true;
        var button = img.gameObject.AddComponent<Button>();
        button.targetGraphic = img;
        var colors = button.colors;
        colors.normalColor = new Color(0.8f, 0.8f, 0.8f, 1f);
        colors.highlightedColor = Color.white;
        colors.pressedColor = new Color(0.6f, 0.6f, 0.6f, 1f);
        button.colors = colors;

        label = MakeText(img.transform, "Label", 30, TextAnchor.MiddleCenter, Center, Center, Vector2.zero, size);
        return button;
    }

    static Sprite MakeVignetteSprite()
    {
        const int n = 128;
        var tex = new Texture2D(n, n, TextureFormat.RGBA32, false) { wrapMode = TextureWrapMode.Clamp };
        var px = new Color32[n * n];
        for (int y = 0; y < n; y++)
        {
            for (int x = 0; x < n; x++)
            {
                float dx = (x + 0.5f) / n * 2f - 1f;
                float dy = (y + 0.5f) / n * 2f - 1f;
                float d = Mathf.Sqrt(dx * dx + dy * dy) / 1.41421f;
                float a = Mathf.SmoothStep(0.35f, 1f, d);
                px[y * n + x] = new Color32(255, 255, 255, (byte)(a * 255f));
            }
        }
        tex.SetPixels32(px);
        tex.Apply();
        return Sprite.Create(tex, new Rect(0, 0, n, n), new Vector2(0.5f, 0.5f));
    }
}
