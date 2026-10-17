package app.lovable.projectresonance;

import com.getcapacitor.BridgeActivity;

/** Registers the local model/permission bridge before Capacitor creates the WebView. */
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(R2T2Plugin.class);
        registerPlugin(StepPlanPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
