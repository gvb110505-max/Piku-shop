using System.Collections.Generic;
using UnityEngine;

/// <summary>
/// E키로 상호작용하는 모든 오브젝트의 베이스.
/// 활성화된 Interactable은 static 목록에 등록되고, PlayerController가 거리로 가장 가까운 대상을 고른다.
/// (물리 충돌에 의존하지 않으므로 비주얼을 어떤 모델로 바꿔도 동작한다.)
/// </summary>
public abstract class Interactable : MonoBehaviour
{
    public static readonly List<Interactable> All = new List<Interactable>();

    [Header("상호작용")]
    [Tooltip("프롬프트 뒤에 붙는 행동 설명. 예) 씨앗 줍기")]
    [SerializeField] protected string actionLabel = "";
    [SerializeField] protected float interactRange = 3f;

    public float InteractRange => interactRange;

    protected virtual void OnEnable() => All.Add(this);
    protected virtual void OnDisable() => All.Remove(this);

    /// <summary>지금 상호작용할 수 있는가? (퀘스트 단계/소지품 조건 등)</summary>
    public virtual bool CanInteract(PlayerController player) => true;

    public virtual string GetPrompt() =>
        string.IsNullOrEmpty(actionLabel) ? "E: 상호작용" : $"E: 상호작용 ({actionLabel})";

    public abstract void Interact(PlayerController player);
}
