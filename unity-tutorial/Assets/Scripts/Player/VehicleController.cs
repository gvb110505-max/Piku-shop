using UnityEngine;

/// <summary>
/// 낡은 차 운전. W/S 가속·후진, A/D 조향, E 하차.
/// 충돌 처리는 CharacterController를 사용해 간단하게 한다(벽/건물에 막힘).
/// 열기 중에는 최대 속도에도 HeatSystem 배율이 적용된다.
/// </summary>
[RequireComponent(typeof(CharacterController))]
public class VehicleController : MonoBehaviour
{
    [Header("운전")]
    [SerializeField] float maxSpeed = 28f;
    [SerializeField] float reverseMaxSpeed = 8f;
    [SerializeField] float acceleration = 14f;
    [SerializeField] float coastDeceleration = 8f;
    [SerializeField] float steerSpeed = 80f;
    [SerializeField] float gravity = -25f;

    [Header("하차")]
    [SerializeField] float exitSideOffset = 2.8f;

    public bool IsDriven { get; private set; }

    CharacterController cc;
    PlayerController rider;
    float speed;
    float verticalVelocity;
    int boardedFrame;

    void Awake() => cc = GetComponent<CharacterController>();

    public void Board(PlayerController player)
    {
        rider = player;
        rider.SetControl(false);
        rider.gameObject.SetActive(false);

        IsDriven = true;
        speed = 0f;
        boardedFrame = Time.frameCount;

        GameManager.Instance.SetDriving(true, transform);
        QuestManager.Instance.OnVehicleBoarded();
    }

    void Exit()
    {
        IsDriven = false;
        speed = 0f;

        rider.gameObject.SetActive(true);
        Vector3 pos = transform.position - transform.right * exitSideOffset;
        rider.Teleport(pos, Quaternion.LookRotation(transform.forward));
        rider.SetControl(true);

        GameManager.Instance.SetDriving(false, rider.transform);
        QuestManager.Instance.OnVehicleExited();
    }

    void Update()
    {
        if (!IsDriven) return;

        var gm = GameManager.Instance;
        if (gm.State != GameState.Playing)
        {
            // 게임 종료 후에는 서서히 멈춤
            speed = Mathf.MoveTowards(speed, 0f, coastDeceleration * 3f * Time.deltaTime);
            Drive(speed);
            return;
        }

        UIManager.Instance.ShowPrompt("WASD: 운전  |  E: 하차");

        float v = Input.GetAxisRaw("Vertical");
        float h = Input.GetAxisRaw("Horizontal");
        float heatMul = HeatSystem.Instance != null ? HeatSystem.Instance.SpeedMultiplier : 1f;

        float target = v > 0f ? maxSpeed * heatMul : v < 0f ? -reverseMaxSpeed * heatMul : 0f;
        float rate = Mathf.Abs(v) > 0.01f ? acceleration : coastDeceleration;
        speed = Mathf.MoveTowards(speed, target, rate * Time.deltaTime);

        // 정지 상태에선 조향 불가, 후진 시 조향 반전
        float steerFactor = Mathf.Clamp01(Mathf.Abs(speed) / 4f) * Mathf.Sign(speed);
        transform.Rotate(0f, h * steerSpeed * steerFactor * Time.deltaTime, 0f);

        Drive(speed);

        // 탑승한 같은 프레임의 E 입력으로 바로 내리지 않도록 보호
        if (Input.GetKeyDown(KeyCode.E) && Time.frameCount != boardedFrame)
        {
            UIManager.Instance.HidePrompt();
            Exit();
        }
    }

    void Drive(float forwardSpeed)
    {
        if (cc.isGrounded && verticalVelocity < 0f) verticalVelocity = -2f;
        verticalVelocity += gravity * Time.deltaTime;

        Vector3 velocity = transform.forward * forwardSpeed;
        velocity.y = verticalVelocity;
        cc.Move(velocity * Time.deltaTime);
    }
}
