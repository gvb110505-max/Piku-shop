using System;
using System.Collections.Generic;
using UnityEngine;

public enum QuestStep
{
    WakeUp,         // 페이드 인 (조작 불가)
    GoToShop,       // 낡은 가게로 가자
    TalkToMonster,  // 괴물에게 코인을 준다
    TakeSeed,       // 입 안의 씨앗 줍기
    GoToHouse,      // 집으로 들어가자
    GetWater,       // 물통 상호작용
    PlantSeed,      // 밭에 씨앗 심기
    WaterSeed,      // 물 주기
    CoverPlot,      // 가림막 씌우기 (열기 경고 후)
    GoToCar,        // 차로 가자 (타이머 진행 중)
    DriveToShelter, // 운전 중
    Completed
}

/// <summary>
/// 튜토리얼 진행 단계, 목표 텍스트, 목표 마커를 관리한다.
/// 각 단계의 완료 조건은 해당 Interactable / SafeZone이 호출한다.
/// </summary>
public class QuestManager : MonoBehaviour
{
    public static QuestManager Instance { get; private set; }

    [Serializable]
    public class StepText
    {
        public QuestStep step;
        public string objective;
    }

    [Header("목표 텍스트 (상단 표시)")]
    [SerializeField]
    List<StepText> objectives = new List<StepText>
    {
        new StepText { step = QuestStep.WakeUp, objective = "" },
        new StepText { step = QuestStep.GoToShop, objective = "앞에 있는 낡은 가게로 가자" },
        new StepText { step = QuestStep.TalkToMonster, objective = "가게 안의 괴물에게 다가가 말을 걸어보자" },
        new StepText { step = QuestStep.TakeSeed, objective = "괴물의 입 안에 있는 씨앗을 집자" },
        new StepText { step = QuestStep.GoToHouse, objective = "앞에 있는 집으로 들어가자" },
        new StepText { step = QuestStep.GetWater, objective = "집 안의 물통을 살펴보자" },
        new StepText { step = QuestStep.PlantSeed, objective = "씨앗을 심자" },
        new StepText { step = QuestStep.WaterSeed, objective = "씨앗에 물을 주자" },
        new StepText { step = QuestStep.CoverPlot, objective = "새싹에 가림막을 씌우자" },
        new StepText { step = QuestStep.GoToCar, objective = "낡은 차를 타고 임시거처로 가자" },
        new StepText { step = QuestStep.DriveToShelter, objective = "낡은 차를 타고 임시거처로 가자" },
        new StepText { step = QuestStep.Completed, objective = "" },
    };

    [Header("목표 지점 (마커가 따라갈 대상)")]
    [SerializeField] Transform shopDoor;
    [SerializeField] Transform monster;
    [SerializeField] Transform seed;
    [SerializeField] Transform houseDoor;
    [SerializeField] Transform waterTank;
    [SerializeField] Transform farmPlot;
    [SerializeField] Transform car;
    [SerializeField] Transform shelter;

    [Header("마커")]
    [SerializeField] ObjectiveMarker marker;
    [SerializeField] float markerHeight = 4.5f;

    public QuestStep Current { get; private set; } = QuestStep.WakeUp;

    void Awake() => Instance = this;

    void OnEnable() => SafeZone.PlayerEntered += OnZoneEntered;
    void OnDisable() => SafeZone.PlayerEntered -= OnZoneEntered;

    public void SetStep(QuestStep step)
    {
        Current = step;

        if (UIManager.Instance != null) UIManager.Instance.SetObjective(TextFor(step));

        if (marker != null)
        {
            Transform t = TargetFor(step);
            if (t != null) marker.SetTarget(t, markerHeight);
            else marker.Hide();
        }
    }

    /// <summary>현재 단계가 expected일 때만 next로 넘어간다 (중복 호출 방지).</summary>
    public void CompleteStep(QuestStep expected, QuestStep next)
    {
        if (Current == expected) SetStep(next);
    }

    public void OnVehicleBoarded() => CompleteStep(QuestStep.GoToCar, QuestStep.DriveToShelter);
    public void OnVehicleExited() => CompleteStep(QuestStep.DriveToShelter, QuestStep.GoToCar);

    void OnZoneEntered(SafeZone zone)
    {
        switch (zone.Type)
        {
            case SafeZone.ZoneType.Shop:
                CompleteStep(QuestStep.GoToShop, QuestStep.TalkToMonster);
                break;
            case SafeZone.ZoneType.House:
                CompleteStep(QuestStep.GoToHouse, QuestStep.GetWater);
                break;
            case SafeZone.ZoneType.Shelter:
                // 타이머 시작 이후(진행 중이거나 막 종료된 뒤 생존해서 도착)에만 성공 처리
                if (Current == QuestStep.GoToCar || Current == QuestStep.DriveToShelter)
                {
                    SetStep(QuestStep.Completed);
                    GameManager.Instance.OnReachedShelter();
                }
                break;
        }
    }

    string TextFor(QuestStep step)
    {
        foreach (var o in objectives)
            if (o.step == step) return o.objective;
        return "";
    }

    Transform TargetFor(QuestStep step)
    {
        switch (step)
        {
            case QuestStep.GoToShop: return shopDoor;
            case QuestStep.TalkToMonster: return monster;
            case QuestStep.TakeSeed: return seed;
            case QuestStep.GoToHouse: return houseDoor;
            case QuestStep.GetWater: return waterTank;
            case QuestStep.PlantSeed:
            case QuestStep.WaterSeed:
            case QuestStep.CoverPlot: return farmPlot;
            case QuestStep.GoToCar: return car;
            case QuestStep.DriveToShelter: return shelter;
            default: return null;
        }
    }
}
