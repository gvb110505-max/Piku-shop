using UnityEngine;

/// <summary>
/// WASD 이동(카메라 기준) + E 상호작용. 가장 가까운 상호작용 가능 대상의 프롬프트를 UI에 표시한다.
/// 열기 중에는 HeatSystem의 속도 배율이 곱해져 점점 느려진다.
/// </summary>
[RequireComponent(typeof(CharacterController))]
public class PlayerController : MonoBehaviour
{
    [Header("이동")]
    [SerializeField] float moveSpeed = 5f;
    [SerializeField] float rotateSpeed = 14f;
    [SerializeField] float gravity = -25f;

    [Header("참조")]
    [SerializeField] ThirdPersonCamera cameraRig;

    public bool Controllable { get; private set; }

    CharacterController cc;
    float verticalVelocity;
    Interactable focused;

    void Awake() => cc = GetComponent<CharacterController>();

    public void SetControl(bool on)
    {
        Controllable = on;
        if (!on)
        {
            focused = null;
            if (UIManager.Instance != null) UIManager.Instance.HidePrompt();
        }
    }

    /// <summary>CharacterController가 켜진 상태에서 위치를 직접 바꾸면 무시되므로 잠깐 끄고 이동.</summary>
    public void Teleport(Vector3 position, Quaternion rotation)
    {
        cc.enabled = false;
        transform.SetPositionAndRotation(position, rotation);
        cc.enabled = true;
        verticalVelocity = 0f;
    }

    void Update()
    {
        if (!Controllable) return;

        Move();
        UpdateFocus();

        if (focused != null && Input.GetKeyDown(KeyCode.E))
            focused.Interact(this);
    }

    void Move()
    {
        Vector3 input = Vector3.ClampMagnitude(new Vector3(Input.GetAxisRaw("Horizontal"), 0f, Input.GetAxisRaw("Vertical")), 1f);
        float yaw = cameraRig != null ? cameraRig.Yaw : 0f;
        Vector3 dir = Quaternion.Euler(0f, yaw, 0f) * input;

        float speedMul = HeatSystem.Instance != null ? HeatSystem.Instance.SpeedMultiplier : 1f;

        if (cc.isGrounded && verticalVelocity < 0f) verticalVelocity = -2f;
        verticalVelocity += gravity * Time.deltaTime;

        Vector3 velocity = dir * (moveSpeed * speedMul);
        velocity.y = verticalVelocity;
        cc.Move(velocity * Time.deltaTime);

        if (dir.sqrMagnitude > 0.01f)
            transform.rotation = Quaternion.Slerp(transform.rotation, Quaternion.LookRotation(dir), rotateSpeed * Time.deltaTime);
    }

    void UpdateFocus()
    {
        Interactable best = null;
        float bestDist = float.MaxValue;
        Vector3 p = transform.position;

        foreach (var i in Interactable.All)
        {
            if (!i.CanInteract(this)) continue;

            Vector3 d = i.transform.position - p;
            d.y = 0f;
            float dist = d.magnitude;
            if (dist > i.InteractRange || dist >= bestDist) continue;

            best = i;
            bestDist = dist;
        }

        focused = best;
        if (best != null) UIManager.Instance.ShowPrompt(best.GetPrompt());
        else UIManager.Instance.HidePrompt();
    }
}
