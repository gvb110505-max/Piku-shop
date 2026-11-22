using UnityEngine;

/// <summary>
/// 현재 목표 위에 떠 있는 노란 화살표. QuestManager가 대상을 바꿔준다.
/// 멀수록 크게 보이도록 거리 비례로 스케일을 키운다(멀리 있는 임시거처용).
/// </summary>
public class ObjectiveMarker : MonoBehaviour
{
    [SerializeField] float bobHeight = 0.4f;
    [SerializeField] float bobSpeed = 3f;
    [SerializeField] float spinSpeed = 90f;
    [SerializeField] float baseScale = 1f;
    [SerializeField] float distanceScale = 0.015f;
    [SerializeField] float maxScale = 14f;

    Transform target;
    float heightOffset;
    Camera cam;

    public void SetTarget(Transform t, float height)
    {
        target = t;
        heightOffset = height;
        gameObject.SetActive(t != null);
    }

    public void Hide()
    {
        target = null;
        gameObject.SetActive(false);
    }

    void LateUpdate()
    {
        if (target == null) return;
        if (cam == null) cam = Camera.main;

        float dist = cam != null ? Vector3.Distance(cam.transform.position, target.position) : 0f;
        float s = Mathf.Clamp(baseScale + dist * distanceScale, baseScale, maxScale);
        transform.localScale = Vector3.one * s;

        float bob = Mathf.Sin(Time.time * bobSpeed) * bobHeight;
        transform.position = target.position + Vector3.up * ((heightOffset + bob) * s);
        transform.Rotate(0f, spinSpeed * Time.deltaTime, 0f, Space.World);
    }
}
