package app.lovable.projectresonance;

import org.junit.Test;
import static org.junit.Assert.*;
import java.io.ByteArrayInputStream;
import java.io.IOException;

/** Pure JVM checks for credential injection, bounded audio and fixed Step Plan request policy. */
public class StepPlanPolicyTest {
    @Test public void acceptsCompleteKeyWithoutChangingItsValue() {
        assertEquals("test-only-credential-123", StepPlanPolicy.validateKey(" test-only-credential-123 "));
    }

    @Test public void rejectsMaskedAndHeaderInjectedKeysWithoutEchoingThem() {
        for (String value : new String[]{"test...masked", "****masked", "test-key\r\nHeader:123", "test key with spaces", "测试密钥123456"}) {
            IllegalArgumentException error = assertThrows(IllegalArgumentException.class, () -> StepPlanPolicy.validateKey(value));
            assertFalse(error.getMessage().contains(value));
        }
    }

    @Test public void rejectsInvalidTextSpeedAndVoice() {
        assertThrows(IllegalArgumentException.class, () -> StepPlanPolicy.validateSpeech("a".repeat(1001), "qinqienvsheng", 1));
        assertThrows(IllegalArgumentException.class, () -> StepPlanPolicy.validateSpeech("你好", "qinqienvsheng", Double.NaN));
        assertThrows(IllegalArgumentException.class, () -> StepPlanPolicy.validateSpeech("你好", "invalid voice", 1));
        StepPlanPolicy.validateSpeech("你好", "qinqienvsheng", 0.8);
    }

    @Test public void onlyAcceptsNonemptyBoundedAudio() throws Exception {
        assertTrue(StepPlanPolicy.isAudio("Audio/MPEG; charset=binary"));
        assertFalse(StepPlanPolicy.isAudio("application/json"));
        assertFalse(StepPlanPolicy.isAudio(null));
        assertArrayEquals(new byte[]{0, -1, 42}, StepPlanPolicy.readAudio(new ByteArrayInputStream(new byte[]{0, -1, 42})));
        assertThrows(IOException.class, () -> StepPlanPolicy.readAudio(new ByteArrayInputStream(new byte[0])));
        assertThrows(IOException.class, () -> StepPlanPolicy.readAudio(new ByteArrayInputStream(new byte[StepPlanPolicy.MAX_AUDIO_BYTES + 1])));
    }

    @Test public void mapsAuthenticationQuotaAndEndpointFailures() {
        assertTrue(StepPlanPolicy.httpError(401).contains("API Key"));
        assertTrue(StepPlanPolicy.httpError(403).contains("权限"));
        assertTrue(StepPlanPolicy.httpError(429).contains("额度"));
        assertTrue(StepPlanPolicy.httpError(405).contains("HTTP 405"));
        assertTrue(StepPlanPolicy.httpError(500).contains("HTTP 500"));
    }
}
