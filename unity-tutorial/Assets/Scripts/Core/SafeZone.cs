using System;
using System.Collections.Generic;
using UnityEngine;

/// <summary>
/// 안전 구역(가게/집 내부, 임시거처 그늘). BoxCollider(트리거)의 범위를 영역으로 사용한다.
/// 플레이어가 차량에 타고 있으면 차량 위치를 기준으로 판정한다. (GameManager.PlayerPosition)
/// 높이(Y)는 무시하고 XZ 범위만 본다.
/// </summary>
[RequireComponent(typeof(BoxCollider))]
public class SafeZone : MonoBehaviour
{
    public enum ZoneType { Shop, House, Shelter }

    [SerializeField] ZoneType type = ZoneType.House;
    [Tooltip("true면 아침 열기를 막아주는 안전 구역")]
    [SerializeField] bool providesSafety = true;

    public ZoneType Type => type;
    public bool ProvidesSafety => providesSafety;

    public static event Action<SafeZone> PlayerEntered;
    public static event Action<SafeZone> PlayerExited;

    static readonly List<SafeZone> all = new List<SafeZone>();

    BoxCollider box;
    bool playerInside;

    void Awake()
    {
        box = GetComponent<BoxCollider>();
        box.isTrigger = true;
    }

    void OnEnable() => all.Add(this);

    void OnDisable()
    {
        all.Remove(this);
        playerInside = false;
    }

    public bool Contains(Vector3 worldPos)
    {
        Bounds b = box.bounds;
        worldPos.y = b.center.y;
        return b.Contains(worldPos);
    }

    /// <summary>해당 위치가 열기를 막아주는 구역 안인가?</summary>
    public static bool IsSafe(Vector3 worldPos)
    {
        for (int i = 0; i < all.Count; i++)
            if (all[i].providesSafety && all[i].Contains(worldPos)) return true;
        return false;
    }

    void Update()
    {
        var gm = GameManager.Instance;
        if (gm == null || gm.State != GameState.Playing) return;

        bool inside = Contains(gm.PlayerPosition);
        if (inside == playerInside) return;

        playerInside = inside;
        if (inside) PlayerEntered?.Invoke(this);
        else PlayerExited?.Invoke(this);
    }
}
