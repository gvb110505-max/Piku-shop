using UnityEngine;

/// <summary>
/// 3인칭 궤도 카메라. 마우스로 회전하고 Target(플레이어 또는 차량)을 따라간다.
/// 열기 게이지(HeatSystem.Heat01)에 비례해 화면 흔들림 / 롤 / FOV 일렁임(열기 왜곡 느낌)을 준다.
/// </summary>
[RequireComponent(typeof(Camera))]
public class ThirdPersonCamera : MonoBehaviour
{
    [Header("궤도 카메라")]
    [SerializeField] float distance = 7f;
    [SerializeField] float focusHeight = 1.6f;
    [SerializeField] float mouseSensitivity = 2.5f;
    [SerializeField] float minPitch = -10f;
    [SerializeField] float maxPitch = 65f;
    [SerializeField] float startPitch = 20f;
    [SerializeField] float farClip = 2000f;

    [Header("열기 연출 (게이지 1일 때 최대값)")]
    [SerializeField] float shakeAmount = 0.25f;
    [SerializeField] float rollAmount = 4f;
    [SerializeField] float fovWobble = 6f;

    public Transform Target { get; set; }
    public float Yaw => yaw;

    float yaw;
    float pitch;
    float baseFov;
    Camera cam;

    void Awake()
    {
        cam = GetComponent<Camera>();
        baseFov = cam.fieldOfView;
        cam.farClipPlane = farClip;
        pitch = startPitch;
    }

    void LateUpdate()
    {
        if (Target == null) return;

        if (Cursor.lockState == CursorLockMode.Locked)
        {
            yaw += Input.GetAxis("Mouse X") * mouseSensitivity;
            pitch = Mathf.Clamp(pitch - Input.GetAxis("Mouse Y") * mouseSensitivity, minPitch, maxPitch);
        }

        Vector3 focus = Target.position + Vector3.up * focusHeight;
        Quaternion rot = Quaternion.Euler(pitch, yaw, 0f);
        Vector3 back = rot * Vector3.back;

        // 벽/지면에 파묻히지 않도록 거리 보정 (자기 자신은 무시)
        float dist = distance;
        RaycastHit[] hits = Physics.RaycastAll(focus, back, distance, ~0, QueryTriggerInteraction.Ignore);
        foreach (var hit in hits)
        {
            if (hit.transform.IsChildOf(Target)) continue;
            dist = Mathf.Min(dist, Mathf.Max(0.8f, hit.distance - 0.3f));
        }

        Vector3 pos = focus + back * dist;

        float heat = HeatSystem.Instance != null ? HeatSystem.Instance.Heat01 : 0f;
        float roll = 0f;
        float fov = baseFov;
        if (heat > 0.001f)
        {
            pos += Random.insideUnitSphere * (shakeAmount * heat);
            roll = Mathf.Sin(Time.time * 6f) * rollAmount * heat;
            fov = baseFov + Mathf.Sin(Time.time * 4f) * fovWobble * heat;
        }

        transform.SetPositionAndRotation(pos, rot * Quaternion.Euler(0f, 0f, roll));
        cam.fieldOfView = fov;
    }
}
