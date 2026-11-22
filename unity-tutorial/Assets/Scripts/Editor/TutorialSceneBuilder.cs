#if UNITY_EDITOR
using System.Collections.Generic;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.SceneManagement;

/// <summary>
/// 메뉴 [Tutorial > Build Tutorial Scene] 한 번으로 기본 도형 + 단색 머티리얼 + 라벨로
/// 튜토리얼 씬 전체(오브젝트, 매니저, 카메라, 조명)를 현재 씬에 배치한다.
/// 나중에 실제 모델로 교체할 때는 각 오브젝트의 'Visual' 자식만 바꿔 끼우면 된다.
///
/// 배치 (z 방향이 앞):  시작(0,0,0) → 가게(0,0,14) → 집(18,0,14) → 밭(18,0,4) → 차(27,0,6) → 임시거처(30,0,600)
/// </summary>
public static class TutorialSceneBuilder
{
    const string RootName = "TutorialWorld";
    const string MatDir = "Assets/Materials/Tutorial";
    static readonly Dictionary<string, Material> matCache = new Dictionary<string, Material>();

    [MenuItem("Tutorial/Build Tutorial Scene")]
    public static void Build()
    {
        var existing = GameObject.Find(RootName);
        if (existing != null)
        {
            if (!EditorUtility.DisplayDialog("튜토리얼 씬 생성", "이미 생성된 튜토리얼 오브젝트가 있습니다. 지우고 다시 만들까요?", "다시 만들기", "취소"))
                return;
            Object.DestroyImmediate(existing);
        }

        EnsureFolder("Assets/Materials");
        EnsureFolder(MatDir);

        var root = new GameObject(RootName).transform;

        // ---- 머티리얼 ----
        var matGround = Mat("Ground", new Color(0.55f, 0.32f, 0.17f));
        var matPlayer = Mat("Player", new Color(0.15f, 0.35f, 0.95f));
        var matFace = Mat("PlayerFace", new Color(0.9f, 0.95f, 1f));
        var matShopWall = Mat("ShopWall", new Color(0.5f, 0.5f, 0.52f));
        var matShopRoof = Mat("ShopRoof", new Color(0.36f, 0.36f, 0.38f));
        var matDoor = Mat("Door", new Color(0.12f, 0.1f, 0.1f));
        var matHouseWall = Mat("HouseWall", new Color(0.86f, 0.78f, 0.6f));
        var matHouseRoof = Mat("HouseRoof", new Color(0.7f, 0.6f, 0.45f));
        var matMonster = Mat("Monster", new Color(0.4f, 0.12f, 0.55f));
        var matJaw = Mat("MonsterJaw", new Color(0.5f, 0.2f, 0.66f));
        var matToothWhite = Mat("ToothWhite", new Color(0.95f, 0.95f, 0.9f));
        var matToothYellow = Mat("ToothYellow", new Color(0.88f, 0.78f, 0.3f));
        var matSeed = Mat("Seed", new Color(0.2f, 0.8f, 0.25f));
        var matWater = Mat("WaterTank", new Color(0.45f, 0.78f, 1f));
        var matPlot = Mat("Plot", new Color(0.24f, 0.14f, 0.08f));
        var matSprout = Mat("Sprout", new Color(0.6f, 0.95f, 0.35f));
        var matCover = Mat("Cover", new Color(0.6f, 0.6f, 0.62f, 0.55f), true);
        var matCar = Mat("CarBody", new Color(0.7f, 0.33f, 0.12f));
        var matCarCabin = Mat("CarCabin", new Color(0.55f, 0.26f, 0.1f));
        var matWheel = Mat("Wheel", new Color(0.05f, 0.05f, 0.05f));
        var matShelterRoof = Mat("ShelterRoof", new Color(0.5f, 0.55f, 0.62f));
        var matShelterPole = Mat("ShelterPole", new Color(0.4f, 0.3f, 0.2f));
        var matMarker = Mat("Marker", new Color(1f, 0.9f, 0.1f, 1f), true);

        // ---- 지면 (Plane 80x140 → 800 x 1400 m) ----
        Prim(PrimitiveType.Plane, "Ground", root, new Vector3(0f, 0f, 300f), new Vector3(80f, 1f, 140f), matGround, true);

        // ---- 가게 (회색 건물, 문 -Z 방향) ----
        var shop = Building(root, "Shop", new Vector3(0f, 0f, 14f), 9f, 3.5f, 8f, 2.4f, 2.6f, matShopWall, matDoor, matShopRoof);
        Label(shop.gameObject, "낡은 가게", 5.6f, 0.15f, 120f);
        var shopDoorPoint = Empty("DoorPoint", shop, new Vector3(0f, 0f, -5f));
        Zone(shop, "ShopZone", SafeZone.ZoneType.Shop, new Vector3(0f, 1.75f, 0f), new Vector3(8f, 3.5f, 7f));

        // ---- 괴물 (가게 안, 입이 -Z = 문 쪽을 향함) ----
        var monsterRoot = Empty("Monster", shop, new Vector3(0f, 0f, 1.8f));
        monsterRoot.localRotation = Quaternion.Euler(0f, 180f, 0f);
        var monsterVisual = Empty("Visual", monsterRoot, Vector3.zero);
        Prim(PrimitiveType.Sphere, "Body", monsterVisual, new Vector3(0f, 1.7f, 0f), Vector3.one * 3.2f, matMonster, true);
        var upperJaw = Empty("UpperJawPivot", monsterVisual, new Vector3(0f, 1.45f, 1.2f));
        var lowerJaw = Empty("LowerJawPivot", monsterVisual, new Vector3(0f, 1.35f, 1.2f));
        Prim(PrimitiveType.Sphere, "UpperJaw", upperJaw, new Vector3(0f, 0.15f, 0.7f), new Vector3(2f, 0.55f, 1.6f), matJaw);
        Prim(PrimitiveType.Sphere, "LowerJaw", lowerJaw, new Vector3(0f, -0.15f, 0.7f), new Vector3(2f, 0.55f, 1.6f), matJaw);
        BuildTeeth(upperJaw, true, matToothWhite, matToothYellow);
        BuildTeeth(lowerJaw, false, matToothWhite, matToothYellow);
        Label(monsterRoot.gameObject, "괴물", 4.4f, 0.12f);

        // 씨앗 (괴물 입 안, 처음엔 숨김)
        var seedRoot = Empty("Seed", monsterRoot, new Vector3(0f, 1.4f, 1.9f));
        Prim(PrimitiveType.Sphere, "Visual", seedRoot, Vector3.zero, Vector3.one * 0.3f, matSeed);
        Label(seedRoot.gameObject, "씨앗", 0.5f, 0.06f);
        var seedComp = seedRoot.gameObject.AddComponent<Seed>();
        seedRoot.gameObject.SetActive(false);

        var monsterComp = monsterRoot.gameObject.AddComponent<Monster>();
        SetRef(monsterComp, "upperJaw", upperJaw);
        SetRef(monsterComp, "lowerJaw", lowerJaw);
        SetRef(monsterComp, "seed", seedComp);

        // ---- 집 (베이지 건물) ----
        var house = Building(root, "House", new Vector3(18f, 0f, 14f), 8f, 3.5f, 7f, 2.2f, 2.6f, matHouseWall, matDoor, matHouseRoof);
        Label(house.gameObject, "집", 5.6f, 0.15f, 120f);
        var houseDoorPoint = Empty("DoorPoint", house, new Vector3(0f, 0f, -4.5f));
        Zone(house, "HouseZone", SafeZone.ZoneType.House, new Vector3(0f, 1.75f, 0f), new Vector3(7.2f, 3.5f, 6.2f));

        // 물통 (집 안)
        var tank = Empty("WaterTank", house, new Vector3(-2.5f, 0f, 1.5f));
        Prim(PrimitiveType.Cylinder, "Visual", tank, new Vector3(0f, 0.6f, 0f), new Vector3(0.9f, 0.6f, 0.9f), matWater, true);
        Label(tank.gameObject, "물통", 1.8f, 0.1f);
        tank.gameObject.AddComponent<WaterTank>();

        // ---- 밭 (집 앞) ----
        var plot = Empty("FarmPlot", root, new Vector3(18f, 0f, 4f));
        var plotVisual = Empty("Visual", plot, Vector3.zero);
        Prim(PrimitiveType.Cube, "Soil", plotVisual, new Vector3(0f, 0.1f, 0f), new Vector3(4f, 0.2f, 3f), matPlot);
        var seedVisual = Prim(PrimitiveType.Sphere, "SeedVisual", plotVisual, new Vector3(0f, 0.3f, 0f), Vector3.one * 0.3f, matSeed);
        var sprout = Prim(PrimitiveType.Cylinder, "Sprout", plotVisual, new Vector3(0f, 0.5f, 0f), new Vector3(0.1f, 0.3f, 0.1f), matSprout);
        var cover = Prim(PrimitiveType.Cube, "Cover", plotVisual, new Vector3(0f, 1.2f, 0f), new Vector3(4.4f, 0.1f, 3.4f), matCover);
        Label(plot.gameObject, "밭", 2.2f, 0.12f);
        var plotComp = plot.gameObject.AddComponent<FarmPlot>();
        SetRef(plotComp, "seedVisual", seedVisual);
        SetRef(plotComp, "sproutVisual", sprout);
        SetRef(plotComp, "coverVisual", cover);

        // ---- 낡은 차 (집 옆, 임시거처 방향 +Z를 향함) ----
        var car = Empty("Car", root, new Vector3(27f, 0f, 6f));
        var carVisual = Empty("Visual", car, Vector3.zero);
        Prim(PrimitiveType.Cube, "Body", carVisual, new Vector3(0f, 0.9f, 0f), new Vector3(2.2f, 0.9f, 4.4f), matCar);
        Prim(PrimitiveType.Cube, "Cabin", carVisual, new Vector3(0f, 1.6f, -0.3f), new Vector3(1.8f, 0.7f, 2f), matCarCabin);
        foreach (float x in new[] { -1.15f, 1.15f })
        {
            foreach (float z in new[] { -1.4f, 1.4f })
            {
                var w = Prim(PrimitiveType.Cylinder, "Wheel", carVisual, new Vector3(x, 0.4f, z), new Vector3(0.8f, 0.15f, 0.8f), matWheel);
                w.transform.localRotation = Quaternion.Euler(0f, 0f, 90f);
            }
        }
        var carCc = car.gameObject.AddComponent<CharacterController>();
        carCc.height = 2.2f;
        carCc.radius = 1.0f;
        carCc.center = new Vector3(0f, 1.1f, 0f);
        Label(car.gameObject, "낡은 차", 3.2f, 0.12f);
        var vehicle = car.gameObject.AddComponent<VehicleController>();
        var carComp = car.gameObject.AddComponent<Car>();
        SetRef(carComp, "vehicle", vehicle);

        // ---- 임시거처 (천막: 기둥 + 넓은 지붕, 아래가 그늘 트리거) ----
        var shelter = Empty("Shelter", root, new Vector3(30f, 0f, 600f));
        var shelterVisual = Empty("Visual", shelter, Vector3.zero);
        foreach (float x in new[] { -6f, 6f })
            foreach (float z in new[] { -6f, 6f })
                Prim(PrimitiveType.Cube, "Pole", shelterVisual, new Vector3(x, 2f, z), new Vector3(0.4f, 4f, 0.4f), matShelterPole, true);
        Prim(PrimitiveType.Cube, "Roof", shelterVisual, new Vector3(0f, 4.15f, 0f), new Vector3(14f, 0.3f, 14f), matShelterRoof);
        Label(shelter.gameObject, "임시거처", 7f, 0.6f, 2000f);
        Zone(shelter, "ShadeZone", SafeZone.ZoneType.Shelter, new Vector3(0f, 2f, 0f), new Vector3(12f, 4f, 12f));

        // ---- 플레이어 (파란 캡슐, 시작 지점) ----
        var player = Empty("Player", root, new Vector3(0f, 0.1f, 0f));
        var playerCc = player.gameObject.AddComponent<CharacterController>();
        playerCc.height = 2f;
        playerCc.radius = 0.45f;
        playerCc.center = new Vector3(0f, 1f, 0f);
        var playerVisual = Empty("Visual", player, Vector3.zero);
        Prim(PrimitiveType.Capsule, "Body", playerVisual, new Vector3(0f, 1f, 0f), new Vector3(0.9f, 1f, 0.9f), matPlayer);
        Prim(PrimitiveType.Cube, "FacingMark", playerVisual, new Vector3(0f, 1.55f, 0.4f), new Vector3(0.5f, 0.18f, 0.2f), matFace);
        Label(player.gameObject, "주인공", 2.6f, 0.09f);
        var playerComp = player.gameObject.AddComponent<PlayerController>();

        // ---- 카메라 / 조명 ----
        var camGo = GameObject.FindWithTag("MainCamera");
        if (camGo == null)
        {
            camGo = new GameObject("Main Camera");
            camGo.tag = "MainCamera";
            camGo.AddComponent<Camera>();
            camGo.AddComponent<AudioListener>();
        }
        var cam = camGo.GetComponent<Camera>();
        cam.clearFlags = CameraClearFlags.SolidColor;
        var camRig = camGo.GetComponent<ThirdPersonCamera>();
        if (camRig == null) camRig = camGo.AddComponent<ThirdPersonCamera>();

        var sunGo = GameObject.Find("Directional Light");
        if (sunGo == null)
        {
            sunGo = new GameObject("Directional Light");
            var l = sunGo.AddComponent<Light>();
            l.type = LightType.Directional;
        }
        sunGo.transform.rotation = Quaternion.Euler(50f, -30f, 0f);
        var sun = sunGo.GetComponent<Light>();

        // ---- 목표 마커 (떠 있는 노란 화살표) ----
        var marker = Empty("ObjectiveMarker", root, Vector3.zero);
        Prim(PrimitiveType.Cylinder, "Shaft", marker, new Vector3(0f, 1.3f, 0f), new Vector3(0.25f, 0.6f, 0.25f), matMarker);
        var head = Prim(PrimitiveType.Cube, "Head", marker, new Vector3(0f, 0.5f, 0f), Vector3.one * 0.8f, matMarker);
        head.transform.localRotation = Quaternion.Euler(35.26f, 0f, 45f); // 꼭짓점이 아래를 향하는 다이아몬드
        var markerComp = marker.gameObject.AddComponent<ObjectiveMarker>();

        // ---- 매니저 ----
        var managers = Empty("Managers", root, Vector3.zero).gameObject;
        var gm = managers.AddComponent<GameManager>();
        var qm = managers.AddComponent<QuestManager>();
        var dayTimer = managers.AddComponent<DayTimer>();
        managers.AddComponent<HeatSystem>();
        managers.AddComponent<UIManager>();

        SetRef(gm, "player", playerComp);
        SetRef(gm, "vehicle", vehicle);
        SetRef(gm, "cameraRig", camRig);
        SetRef(playerComp, "cameraRig", camRig);
        SetRef(dayTimer, "sun", sun);
        SetRef(dayTimer, "skyCamera", cam);

        SetRef(qm, "shopDoor", shopDoorPoint);
        SetRef(qm, "monster", monsterRoot);
        SetRef(qm, "seed", seedRoot);
        SetRef(qm, "houseDoor", houseDoorPoint);
        SetRef(qm, "waterTank", tank);
        SetRef(qm, "farmPlot", plot);
        SetRef(qm, "car", car);
        SetRef(qm, "shelter", shelter);
        SetRef(qm, "marker", markerComp);

        // ---- 마무리 ----
        var scene = SceneManager.GetActiveScene();
        EditorSceneManager.MarkSceneDirty(scene);
        AddSceneToBuildSettings(scene);
        AssetDatabase.SaveAssets();
        Selection.activeGameObject = root.gameObject;

        Debug.Log("[Tutorial] 씬 생성 완료. 씬을 저장(Ctrl+S)한 뒤 Play 하세요. " +
                  "Player Settings > Active Input Handling이 'Input Manager(Old)' 또는 'Both'인지 확인하세요.");
    }

    // =====================================================================
    //  헬퍼
    // =====================================================================

    /// <summary>속이 빈 건물(문 -Z 방향). 벽 4면 + 문 위 상인방 + 지붕 + 옆으로 열린 문짝.</summary>
    static Transform Building(Transform parent, string name, Vector3 pos, float w, float h, float d,
        float doorW, float doorH, Material wall, Material doorMat, Material roof)
    {
        var root = Empty(name, parent, pos);
        var vis = Empty("Visual", root, Vector3.zero);
        const float t = 0.3f;
        float sideW = (w - doorW) / 2f;

        Prim(PrimitiveType.Cube, "WallBack", vis, new Vector3(0f, h / 2f, d / 2f - t / 2f), new Vector3(w, h, t), wall, true);
        Prim(PrimitiveType.Cube, "WallLeft", vis, new Vector3(-w / 2f + t / 2f, h / 2f, 0f), new Vector3(t, h, d), wall, true);
        Prim(PrimitiveType.Cube, "WallRight", vis, new Vector3(w / 2f - t / 2f, h / 2f, 0f), new Vector3(t, h, d), wall, true);
        Prim(PrimitiveType.Cube, "WallFrontL", vis, new Vector3(-(doorW / 2f + sideW / 2f), h / 2f, -d / 2f + t / 2f), new Vector3(sideW, h, t), wall, true);
        Prim(PrimitiveType.Cube, "WallFrontR", vis, new Vector3(doorW / 2f + sideW / 2f, h / 2f, -d / 2f + t / 2f), new Vector3(sideW, h, t), wall, true);
        Prim(PrimitiveType.Cube, "Lintel", vis, new Vector3(0f, (h + doorH) / 2f, -d / 2f + t / 2f), new Vector3(doorW, h - doorH, t), wall, true);
        Prim(PrimitiveType.Cube, "Roof", vis, new Vector3(0f, h + 0.15f, 0f), new Vector3(w + 0.4f, 0.3f, d + 0.4f), roof, true);
        // 문짝: 열린 채 문 왼쪽 바깥에 직각으로 서 있어서 출입을 막지 않는다
        Prim(PrimitiveType.Cube, "Door", vis, new Vector3(-doorW / 2f - 0.1f, doorH / 2f, -d / 2f - doorW / 2f), new Vector3(0.12f, doorH, doorW), doorMat);
        return root;
    }

    /// <summary>괴물 이빨: 불규칙한 크기/기울기/색의 작은 Cube들을 턱 앞쪽 가장자리에 붙인다.</summary>
    static void BuildTeeth(Transform jaw, bool upper, Material white, Material yellow)
    {
        var rng = new System.Random(upper ? 11 : 23);
        int count = 8;
        for (int i = 0; i < count; i++)
        {
            float x = Mathf.Lerp(-0.85f, 0.85f, (i + (float)rng.NextDouble() * 0.6f) / count);
            float z = 0.7f + 0.8f * Mathf.Sqrt(Mathf.Max(0f, 1f - x * x));
            float height = 0.18f + (float)rng.NextDouble() * 0.22f;
            float width = 0.09f + (float)rng.NextDouble() * 0.1f;
            float y = upper ? -0.12f - height / 2f : 0.12f + height / 2f;

            var tooth = Prim(PrimitiveType.Cube, "Tooth", jaw, new Vector3(x, y, z - 0.12f), new Vector3(width, height, width), rng.NextDouble() > 0.5 ? white : yellow);
            tooth.transform.localRotation = Quaternion.Euler((float)(rng.NextDouble() - 0.5) * 30f, (float)rng.NextDouble() * 90f, (float)(rng.NextDouble() - 0.5) * 30f);
        }
    }

    static Material Mat(string name, Color color, bool unlit = false)
    {
        if (matCache.TryGetValue(name, out var cached) && cached != null) return cached;

        string path = $"{MatDir}/{name}.mat";
        var m = AssetDatabase.LoadAssetAtPath<Material>(path);
        if (m == null)
        {
            Shader sh = null;
            if (unlit) sh = Shader.Find("Sprites/Default"); // 반투명/무조명용 (모든 파이프라인에서 동작)
            else
            {
                if (GraphicsSettings.currentRenderPipeline != null) sh = Shader.Find("Universal Render Pipeline/Lit");
                if (sh == null) sh = Shader.Find("Standard");
            }
            if (sh == null) sh = Shader.Find("Sprites/Default");
            m = new Material(sh);
            AssetDatabase.CreateAsset(m, path);
        }
        m.color = color;
        EditorUtility.SetDirty(m);
        matCache[name] = m;
        return m;
    }

    static GameObject Prim(PrimitiveType type, string name, Transform parent, Vector3 localPos, Vector3 scale, Material mat, bool keepCollider = false)
    {
        var go = GameObject.CreatePrimitive(type);
        go.name = name;
        go.transform.SetParent(parent, false);
        go.transform.localPosition = localPos;
        go.transform.localScale = scale;
        go.GetComponent<Renderer>().sharedMaterial = mat;
        if (!keepCollider)
        {
            var c = go.GetComponent<Collider>();
            if (c != null) Object.DestroyImmediate(c);
        }
        return go;
    }

    static Transform Empty(string name, Transform parent, Vector3 localPos)
    {
        var go = new GameObject(name);
        go.transform.SetParent(parent, false);
        go.transform.localPosition = localPos;
        return go.transform;
    }

    static void Zone(Transform parent, string name, SafeZone.ZoneType type, Vector3 center, Vector3 size)
    {
        var go = new GameObject(name);
        go.transform.SetParent(parent, false);
        var box = go.AddComponent<BoxCollider>();
        box.isTrigger = true;
        box.center = center;
        box.size = size;
        var zone = go.AddComponent<SafeZone>();
        var so = new SerializedObject(zone);
        so.FindProperty("type").enumValueIndex = (int)type;
        so.ApplyModifiedPropertiesWithoutUndo();
    }

    static void Label(GameObject go, string text, float height, float charSize, float maxDistance = 60f)
    {
        var label = go.AddComponent<WorldLabel>();
        var so = new SerializedObject(label);
        so.FindProperty("text").stringValue = text;
        so.FindProperty("height").floatValue = height;
        so.FindProperty("characterSize").floatValue = charSize;
        so.FindProperty("maxVisibleDistance").floatValue = maxDistance;
        so.ApplyModifiedPropertiesWithoutUndo();
    }

    static void SetRef(Object target, string property, Object value)
    {
        var so = new SerializedObject(target);
        var p = so.FindProperty(property);
        if (p == null)
        {
            Debug.LogWarning($"[Tutorial] {target.GetType().Name}.{property} 필드를 찾을 수 없습니다.");
            return;
        }
        p.objectReferenceValue = value;
        so.ApplyModifiedPropertiesWithoutUndo();
    }

    static void SetRef(Object target, string property, Component value) => SetRef(target, property, (Object)value);

    static void SetRef(Object target, string property, Transform value) => SetRef(target, property, (Object)value);

    static void EnsureFolder(string path)
    {
        if (AssetDatabase.IsValidFolder(path)) return;
        int i = path.LastIndexOf('/');
        AssetDatabase.CreateFolder(path.Substring(0, i), path.Substring(i + 1));
    }

    static void AddSceneToBuildSettings(Scene scene)
    {
        if (string.IsNullOrEmpty(scene.path)) return; // 저장 전이면 건너뜀 (저장 후 Build Settings에 직접 추가)
        var list = new List<EditorBuildSettingsScene>(EditorBuildSettings.scenes);
        if (list.Exists(s => s.path == scene.path)) return;
        list.Add(new EditorBuildSettingsScene(scene.path, true));
        EditorBuildSettings.scenes = list.ToArray();
    }
}
#endif
