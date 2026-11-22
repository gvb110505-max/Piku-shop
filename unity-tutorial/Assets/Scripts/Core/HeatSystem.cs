using UnityEngine;

/// <summary>
/// 아침(타이머 종료) 이후 안전 구역 밖에 있으면 열기 게이지가 차오르고,
/// deathTime(기본 15초) 동안 계속 노출되면 사망한다. 안전 구역에 들어가면 게이지가 줄어든다.
/// 화면 효과(비네트/흔들림/속도 감소)는 이 값(Heat01)을 읽어서 각 시스템이 처리한다.
/// </summary>
public class HeatSystem : MonoBehaviour
{
    public static HeatSystem Instance { get; private set; }

    [Header("열기 설정")]
    [Tooltip("안전 구역 밖에 계속 있을 때 사망까지 걸리는 시간(초)")]
    [SerializeField] float deathTime = 15f;
    [Tooltip("안전 구역 안에서 초당 게이지(0~1) 회복량")]
    [SerializeField] float recoverRate = 0.5f;
    [Tooltip("게이지가 가득 찼을 때의 이동 속도 배율")]
    [SerializeField, Range(0.05f, 1f)] float minSpeedMultiplier = 0.3f;

    /// <summary>0 = 안전, 1 = 사망</summary>
    public float Heat01 { get; private set; }
    public bool Exposed { get; private set; }
    public float DeathTime => deathTime;
    public float SurvivalRemaining => (1f - Heat01) * deathTime;
    public float SpeedMultiplier => Mathf.Lerp(1f, minSpeedMultiplier, Heat01);

    void Awake() => Instance = this;

    void Update()
    {
        var gm = GameManager.Instance;
        if (gm == null || gm.State != GameState.Playing) return;

        bool morning = DayTimer.Instance != null && DayTimer.Instance.IsExpired;
        Exposed = morning && !SafeZone.IsSafe(gm.PlayerPosition);

        if (Exposed)
        {
            Heat01 += Time.deltaTime / deathTime;
            if (Heat01 >= 1f)
            {
                Heat01 = 1f;
                gm.OnPlayerDied();
            }
        }
        else
        {
            Heat01 = Mathf.MoveTowards(Heat01, 0f, recoverRate * Time.deltaTime);
        }
    }
}
