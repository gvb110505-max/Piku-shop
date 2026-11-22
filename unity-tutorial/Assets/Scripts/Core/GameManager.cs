using System.Collections;
using UnityEngine;
using UnityEngine.SceneManagement;

public enum GameState { Intro, Playing, Success, GameOver }

/// <summary>
/// 게임 전체 상태와 플레이어 소지품(코인/씨앗/물)을 관리한다.
/// 시작 연출 → 플레이 → 성공/게임오버 → 재시작 흐름을 담당.
/// </summary>
public class GameManager : MonoBehaviour
{
    public static GameManager Instance { get; private set; }

    [Header("참조")]
    [SerializeField] PlayerController player;
    [SerializeField] VehicleController vehicle;
    [SerializeField] ThirdPersonCamera cameraRig;

    [Header("시작 설정")]
    [SerializeField] int startCoins = 3;
    [SerializeField] float fadeInDuration = 3f;

    [Header("물 (L)")]
    [SerializeField] float waterCapacity = 1f;
    [Tooltip("물통에서 얻는 양 ('얼마 남지 않음')")]
    [SerializeField] float waterFromTank = 0.12f;
    [Tooltip("물 주기 1회 소모량")]
    [SerializeField] float waterPerWatering = 0.1f;

    [Header("게임 오버 연출")]
    [SerializeField] float deathFadeDuration = 1.5f;
    [SerializeField] Color deathFadeColor = new Color(1f, 0.88f, 0.82f);

    public GameState State { get; private set; } = GameState.Intro;
    public int Coins { get; private set; }
    public bool HasSeed { get; private set; }
    public float Water { get; private set; }
    public float WaterCapacity => waterCapacity;
    public float WaterPerWatering => waterPerWatering;
    public bool IsDriving { get; private set; }

    public PlayerController Player => player;
    public VehicleController Vehicle => vehicle;
    public ThirdPersonCamera CameraRig => cameraRig;

    /// <summary>안전 구역/열기 판정에 쓰는 '플레이어 위치' (운전 중이면 차량 위치)</summary>
    public Vector3 PlayerPosition => IsDriving && vehicle != null ? vehicle.transform.position : player.transform.position;

    void Awake()
    {
        Instance = this;
        Time.timeScale = 1f;
    }

    IEnumerator Start()
    {
        State = GameState.Intro;
        Coins = startCoins;
        Water = 0f;
        HasSeed = false;

        cameraRig.Target = player.transform;
        player.SetControl(false);
        QuestManager.Instance.SetStep(QuestStep.WakeUp);

        // 검은 화면에서 서서히 밝아짐 (시간대: 밤)
        yield return UIManager.Instance.Fade(Color.black, 1f, 0f, fadeInDuration);

        State = GameState.Playing;
        player.SetControl(true);
        UIManager.Instance.SetCursorFree(false);
        QuestManager.Instance.SetStep(QuestStep.GoToShop);
    }

    // ---------- 소지품 ----------
    public bool TrySpendCoins(int amount)
    {
        if (Coins < amount) return false;
        Coins -= amount;
        return true;
    }

    public void GiveSeed() => HasSeed = true;
    public void ConsumeSeed() => HasSeed = false;

    public void FillWater() => Water = Mathf.Min(waterCapacity, waterFromTank);

    public bool TryUseWater()
    {
        if (Water < waterPerWatering - 0.0001f) return false;
        Water = Mathf.Max(0f, Water - waterPerWatering);
        return true;
    }

    // ---------- 차량 ----------
    public void SetDriving(bool driving, Transform cameraTarget)
    {
        IsDriving = driving;
        cameraRig.Target = cameraTarget;
    }

    // ---------- 결과 ----------
    public void OnPlayerDied()
    {
        if (State != GameState.Playing) return;
        State = GameState.GameOver;
        StartCoroutine(DeathRoutine());
    }

    IEnumerator DeathRoutine()
    {
        player.SetControl(false);
        yield return UIManager.Instance.Fade(deathFadeColor, 0f, 1f, deathFadeDuration);
        UIManager.Instance.ShowGameOver();
    }

    public void OnReachedShelter()
    {
        if (State != GameState.Playing) return;
        State = GameState.Success;
        player.SetControl(false);
        UIManager.Instance.ShowSuccess();
    }

    public void Restart()
    {
        SceneManager.LoadScene(SceneManager.GetActiveScene().buildIndex);
    }
}
