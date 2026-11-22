using UnityEngine;
using UnityEngine.Rendering;

/// <summary>
/// '해 뜨기까지 남은 시간' 타이머. 진행도에 따라 하늘/조명 색을 남색 → 붉은 주황색으로 바꾼다.
/// 남은 시간이 warningTime 이하가 되면 매초 경고음을 낸다.
/// 타이머는 FarmPlot에서 가림막을 씌운 순간 StartTimer()로 시작된다.
/// </summary>
public class DayTimer : MonoBehaviour
{
    public static DayTimer Instance { get; private set; }

    [Header("시간 (초)")]
    [SerializeField] float duration = 90f;
    [SerializeField] float warningTime = 30f;

    [Header("하늘 / 조명 색")]
    [SerializeField] Color nightSky = new Color(0.03f, 0.05f, 0.16f);
    [SerializeField] Color dawnSky = new Color(1f, 0.38f, 0.12f);
    [SerializeField] Color nightAmbient = new Color(0.08f, 0.1f, 0.22f);
    [SerializeField] Color dawnAmbient = new Color(0.9f, 0.4f, 0.2f);
    [SerializeField] Color nightSunColor = new Color(0.4f, 0.5f, 0.9f);
    [SerializeField] Color dawnSunColor = new Color(1f, 0.55f, 0.25f);
    [SerializeField] float nightSunIntensity = 0.25f;
    [SerializeField] float dawnSunIntensity = 1.3f;

    [Header("참조")]
    [SerializeField] Light sun;
    [SerializeField] Camera skyCamera;

    [Header("경고음")]
    [SerializeField] float beepFrequency = 880f;

    public bool IsRunning { get; private set; }
    public bool IsExpired { get; private set; }
    public float Remaining { get; private set; }
    public float WarningTime => warningTime;
    public float Duration => duration;

    AudioSource audioSource;
    AudioClip beep;
    int lastBeepSecond = int.MaxValue;

    void Awake()
    {
        Instance = this;
        Remaining = duration;

        audioSource = gameObject.AddComponent<AudioSource>();
        audioSource.spatialBlend = 0f;
        beep = ProceduralAudio.Beep(beepFrequency);

        if (skyCamera == null) skyCamera = Camera.main;
        ApplySky(0f);
    }

    public void StartTimer()
    {
        if (IsRunning || IsExpired) return;
        Remaining = duration;
        IsRunning = true;
    }

    void Update()
    {
        if (!IsRunning) return;
        if (GameManager.Instance.State != GameState.Playing) return;

        Remaining -= Time.deltaTime;

        if (Remaining <= warningTime && Remaining > 0f)
        {
            int sec = Mathf.CeilToInt(Remaining);
            if (sec != lastBeepSecond)
            {
                lastBeepSecond = sec;
                audioSource.PlayOneShot(beep);
            }
        }

        ApplySky(Mathf.Clamp01(1f - Remaining / duration));

        if (Remaining <= 0f)
        {
            Remaining = 0f;
            IsRunning = false;
            IsExpired = true;
            ApplySky(1f);
        }
    }

    void ApplySky(float t)
    {
        if (skyCamera != null)
        {
            skyCamera.clearFlags = CameraClearFlags.SolidColor;
            skyCamera.backgroundColor = Color.Lerp(nightSky, dawnSky, t);
        }

        RenderSettings.ambientMode = AmbientMode.Flat;
        RenderSettings.ambientLight = Color.Lerp(nightAmbient, dawnAmbient, t);

        if (sun != null)
        {
            sun.color = Color.Lerp(nightSunColor, dawnSunColor, t);
            sun.intensity = Mathf.Lerp(nightSunIntensity, dawnSunIntensity, t);
        }
    }
}
