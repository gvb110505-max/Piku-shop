using UnityEngine;

/// <summary>오디오 에셋 없이 쓰는 간단한 사인파 경고음.</summary>
public static class ProceduralAudio
{
    public static AudioClip Beep(float frequency = 880f, float length = 0.18f, float volume = 0.4f)
    {
        const int rate = 44100;
        int samples = Mathf.Max(1, (int)(rate * length));
        var data = new float[samples];
        for (int i = 0; i < samples; i++)
        {
            float envelope = 1f - (float)i / samples;
            data[i] = Mathf.Sin(2f * Mathf.PI * frequency * i / rate) * volume * envelope;
        }
        var clip = AudioClip.Create("Beep", samples, 1, rate, false);
        clip.SetData(data, 0);
        return clip;
    }
}
