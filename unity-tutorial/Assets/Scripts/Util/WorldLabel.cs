using UnityEngine;

/// <summary>
/// 오브젝트 위에 이름을 띄우는 월드 스페이스 텍스트(항상 카메라를 향함).
/// 모델 교체 후에도 디버그 용도로 쓸 수 있고, 필요 없으면 컴포넌트만 제거하면 된다.
/// 루트 오브젝트의 스케일은 1로 유지할 것 (비주얼은 자식에서 스케일).
/// </summary>
public class WorldLabel : MonoBehaviour
{
    [SerializeField] string text = "";
    [SerializeField] float height = 2.5f;
    [SerializeField] float characterSize = 0.1f;
    [SerializeField] Color color = Color.white;
    [SerializeField] float maxVisibleDistance = 60f;

    TextMesh mesh;
    Transform labelTransform;
    Camera cam;

    void Awake()
    {
        var go = new GameObject("Label");
        labelTransform = go.transform;
        labelTransform.SetParent(transform, false);
        labelTransform.localPosition = new Vector3(0f, height, 0f);

        mesh = go.AddComponent<TextMesh>();
        mesh.font = FontProvider.Get();
        mesh.fontSize = 64;
        mesh.characterSize = characterSize;
        mesh.anchor = TextAnchor.MiddleCenter;
        mesh.alignment = TextAlignment.Center;
        mesh.color = color;
        mesh.text = text;

        var r = go.GetComponent<MeshRenderer>();
        r.sharedMaterial = mesh.font.material;
        r.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
        r.receiveShadows = false;
    }

    public void SetText(string value)
    {
        text = value;
        if (mesh != null) mesh.text = value;
    }

    void LateUpdate()
    {
        if (cam == null) cam = Camera.main;
        if (cam == null || labelTransform == null) return;

        float dist = Vector3.Distance(cam.transform.position, labelTransform.position);
        bool visible = dist <= maxVisibleDistance;
        if (labelTransform.gameObject.activeSelf != visible) labelTransform.gameObject.SetActive(visible);
        if (visible) labelTransform.rotation = cam.transform.rotation;
    }
}
