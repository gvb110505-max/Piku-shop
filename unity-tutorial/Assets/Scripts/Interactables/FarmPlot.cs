using System.Collections;
using UnityEngine;

/// <summary>
/// 밭. E를 누를 때마다 단계가 진행된다:
///   씨앗 심기 → 물 주기(파티클, 새싹 등장, 열기 경고) → 가림막 씌우기(타이머 시작)
/// 씨앗/새싹/가림막 비주얼은 모두 이 오브젝트의 자식이며, 시작 시 숨겨진다.
/// </summary>
public class FarmPlot : Interactable
{
    enum PlotState { Empty, Seeded, Sprouted, Covered }

    [Header("비주얼 (자식 오브젝트)")]
    [SerializeField] GameObject seedVisual;
    [SerializeField] GameObject sproutVisual;
    [SerializeField] GameObject coverVisual;

    [Header("연출 시간")]
    [SerializeField] float wateringTime = 1.5f;
    [SerializeField] float sproutGrowTime = 1.5f;
    [SerializeField] float coverDropHeight = 5f;
    [SerializeField] float coverDropTime = 1.2f;

    [Header("열기 경고 안내")]
    [SerializeField, TextArea(2, 4)]
    string heatWarning = "이 행성은 아침마다 약 80도의 열기를 내뿜는다.\n해가 뜨기 전에 식물을 가리고 실내나 임시거처로 피해야 한다.";
    [SerializeField] float warningDuration = 9f;

    PlotState state = PlotState.Empty;
    bool busy;
    Vector3 coverRestLocalPos;
    Vector3 sproutFullScale;
    ParticleSystem waterFx;

    void Reset() => actionLabel = "밭";

    void Awake()
    {
        coverRestLocalPos = coverVisual.transform.localPosition;
        sproutFullScale = sproutVisual.transform.localScale;

        seedVisual.SetActive(false);
        sproutVisual.SetActive(false);
        coverVisual.SetActive(false);

        BuildWaterFx();
    }

    void BuildWaterFx()
    {
        var go = new GameObject("WaterFX");
        go.transform.SetParent(transform, false);
        go.transform.localPosition = new Vector3(0f, 1.8f, 0f);
        go.transform.localRotation = Quaternion.Euler(90f, 0f, 0f); // 아래로 분사

        waterFx = go.AddComponent<ParticleSystem>();
        waterFx.Stop(true, ParticleSystemStopBehavior.StopEmittingAndClear);

        var main = waterFx.main;
        main.loop = true;
        main.playOnAwake = false;
        main.startColor = new Color(0.3f, 0.7f, 1f, 0.9f);
        main.startSize = 0.15f;
        main.startLifetime = 0.6f;
        main.startSpeed = 3f;
        main.gravityModifier = 0.5f;

        var emission = waterFx.emission;
        emission.rateOverTime = 90f;

        var shape = waterFx.shape;
        shape.shapeType = ParticleSystemShapeType.Box;
        shape.scale = new Vector3(1.4f, 1.0f, 0.1f);

        var psr = go.GetComponent<ParticleSystemRenderer>();
        psr.material = new Material(Shader.Find("Sprites/Default"));
    }

    public override bool CanInteract(PlayerController player)
    {
        if (busy) return false;

        var q = QuestManager.Instance.Current;
        var gm = GameManager.Instance;

        switch (state)
        {
            case PlotState.Empty: return q == QuestStep.PlantSeed && gm.HasSeed;
            case PlotState.Seeded: return q == QuestStep.WaterSeed && gm.Water >= gm.WaterPerWatering - 0.0001f;
            case PlotState.Sprouted: return q == QuestStep.CoverPlot;
            default: return false;
        }
    }

    public override string GetPrompt()
    {
        switch (state)
        {
            case PlotState.Empty: return "E: 상호작용 (씨앗 심기)";
            case PlotState.Seeded: return "E: 상호작용 (물 주기)";
            case PlotState.Sprouted: return "E: 상호작용 (가림막 씌우기)";
            default: return base.GetPrompt();
        }
    }

    public override void Interact(PlayerController player)
    {
        switch (state)
        {
            case PlotState.Empty: Plant(); break;
            case PlotState.Seeded: StartCoroutine(WaterRoutine()); break;
            case PlotState.Sprouted: StartCoroutine(CoverRoutine()); break;
        }
    }

    void Plant()
    {
        GameManager.Instance.ConsumeSeed();
        seedVisual.SetActive(true);
        state = PlotState.Seeded;

        UIManager.Instance.ShowToast("씨앗을 심었다");
        QuestManager.Instance.SetStep(QuestStep.WaterSeed);
    }

    IEnumerator WaterRoutine()
    {
        busy = true;
        GameManager.Instance.TryUseWater();

        waterFx.Play();
        yield return new WaitForSeconds(wateringTime);
        waterFx.Stop();

        // 씨앗 → 새싹
        seedVisual.SetActive(false);
        sproutVisual.SetActive(true);
        Transform s = sproutVisual.transform;
        float t = 0f;
        while (t < 1f)
        {
            t += Time.deltaTime / Mathf.Max(0.01f, sproutGrowTime);
            s.localScale = Vector3.Lerp(sproutFullScale * 0.05f, sproutFullScale, Mathf.SmoothStep(0f, 1f, t));
            yield return null;
        }
        s.localScale = sproutFullScale;

        state = PlotState.Sprouted;
        busy = false;

        // 열기 경고 + 가림막 튜토리얼
        UIManager.Instance.ShowBanner(heatWarning, warningDuration);
        QuestManager.Instance.SetStep(QuestStep.CoverPlot);
    }

    IEnumerator CoverRoutine()
    {
        busy = true;

        Transform c = coverVisual.transform;
        coverVisual.SetActive(true);
        Vector3 start = coverRestLocalPos + Vector3.up * coverDropHeight;
        float t = 0f;
        while (t < 1f)
        {
            t += Time.deltaTime / Mathf.Max(0.01f, coverDropTime);
            c.localPosition = Vector3.Lerp(start, coverRestLocalPos, t * t); // 가속하며 낙하
            yield return null;
        }
        c.localPosition = coverRestLocalPos;

        state = PlotState.Covered;
        busy = false;

        DayTimer.Instance.StartTimer();
        UIManager.Instance.ShowToast("해 뜨기까지 시간이 얼마 없다! 서두르자");
        QuestManager.Instance.SetStep(QuestStep.GoToCar);
    }
}
