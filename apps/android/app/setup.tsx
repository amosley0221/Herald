import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { strings, type PairingPayload } from '@herald/core';
import { BodyText, Button, Emblem, Label, Screen } from '../src/components/primitives';
import { body, color, display, space } from '../src/theme';
import { appConfig } from '../src/lib/config';
import { useHerald } from '../src/state/herald';

/**
 * First run.
 *
 * Two ways to start, and the order matters: running on the phone is the
 * default because it needs nothing but a key, and pairing is offered second
 * for anyone who would rather their phone sat idle while something always-on
 * did the scanning. Either way the screens after this are identical.
 */
export default function Setup() {
  const { connect, useThisDevice } = useHerald();
  const insets = useSafeAreaInsets();

  const [mode, setMode] = useState<'choose' | 'scan' | 'manual' | 'engine'>('choose');
  const [apiKey, setApiKeyInput] = useState('');
  const [baseUrl, setBaseUrl] = useState(appConfig.defaultEngineUrl ?? '');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [permission, requestPermission] = useCameraPermissions();

  const attempt = async (credentials: { baseUrl: string; token: string }) => {
    setBusy(true);
    setError(null);
    try {
      await connect({
        baseUrl: normalizeUrl(credentials.baseUrl),
        token: credentials.token.trim(),
      });
      router.replace('/');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : strings.setup.failed);
      setMode('manual');
    } finally {
      setBusy(false);
    }
  };

  const onScan = (data: string) => {
    if (busy) return;
    try {
      const payload = JSON.parse(data) as Partial<PairingPayload>;
      if (!payload.baseUrl || !payload.token) throw new Error('incomplete');
      void attempt({ baseUrl: payload.baseUrl, token: payload.token });
    } catch {
      setError('That code is not a Herald pairing code.');
      setMode('manual');
    }
  };

  if (mode === 'scan') {
    return (
      <View style={[styles.scanner, { paddingTop: insets.top }]}>
        <CameraView
          style={StyleSheet.absoluteFill}
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={({ data }) => onScan(data)}
        />
        <View style={styles.scannerOverlay}>
          <View style={styles.reticle} />
          <BodyText size={13} tone={color.bone} style={{ textAlign: 'center' }}>
            {strings.setup.pairingBody}
          </BodyText>
          <Button variant="ghost" onPress={() => setMode('engine')}>Cancel</Button>
        </View>
      </View>
    );
  }

  return (
    <Screen contentStyle={{ paddingTop: insets.top + space[4], paddingHorizontal: space[3], gap: space[3] }}>
      <Emblem size={40} />
      <View>
        <BodyText size={28} weight={500} style={display(28, 500)}>{strings.brand.wordmark}</BodyText>
        <Label style={{ marginTop: space[1] }}>{strings.setup.title}</Label>
      </View>

      <BodyText size={16} style={{ lineHeight: 26 }}>{strings.setup.body}</BodyText>

      {mode === 'choose' ? (
        <View style={{ gap: space[3], marginTop: space[2] }}>
          <BodyText size={14} tone={color.stone} style={{ lineHeight: 22 }}>
            {strings.setup.onDeviceBody}
          </BodyText>
          <Field
            label={strings.setup.apiKey}
            value={apiKey}
            onChange={setApiKeyInput}
            placeholder="sk-ant-..."
            secure
          />
          <BodyText size={12} tone={color.stone}>{strings.setup.apiKeyHint}</BodyText>
          <Button
            fullWidth
            loading={busy}
            disabled={!apiKey.trim()}
            onPress={async () => {
              setBusy(true);
              setError(null);
              try {
                await useThisDevice(apiKey);
                router.replace('/');
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : strings.errors.generic);
              } finally {
                setBusy(false);
              }
            }}
          >
            {strings.setup.start}
          </Button>
          <Button variant="ghost" fullWidth onPress={() => setMode('engine')}>
            {strings.setup.useEngine}
          </Button>
        </View>
      ) : mode === 'engine' ? (
        <View style={{ gap: space[2], marginTop: space[2] }}>
          <BodyText size={14} tone={color.stone} style={{ lineHeight: 22 }}>
            {strings.setup.engineBody}
          </BodyText>
          <Button
            fullWidth
            loading={busy}
            onPress={async () => {
              if (!permission?.granted) {
                const result = await requestPermission();
                if (!result.granted) {
                  setError('Camera access is needed to scan the pairing code.');
                  setMode('manual');
                  return;
                }
              }
              setMode('scan');
            }}
          >
            {strings.setup.scan}
          </Button>
          <Button variant="ghost" fullWidth onPress={() => setMode('manual')}>
            {strings.setup.manual}
          </Button>
          <Button variant="ghost" fullWidth onPress={() => setMode('choose')}>
            {strings.setup.back}
          </Button>
        </View>
      ) : (
        <View style={{ gap: space[3], marginTop: space[2] }}>
          <Field
            label={strings.setup.baseUrl}
            value={baseUrl}
            onChange={setBaseUrl}
            placeholder="https://herald.example.com"
            keyboardType="url"
          />
          <Field
            label={strings.setup.token}
            value={token}
            onChange={setToken}
            placeholder="Access token"
            secure
          />
          <Button
            fullWidth
            loading={busy}
            disabled={!baseUrl.trim() || !token.trim()}
            onPress={() => void attempt({ baseUrl, token })}
          >
            {strings.setup.connect}
          </Button>
          <Button variant="ghost" fullWidth onPress={() => setMode('engine')}>
            {strings.setup.scan}
          </Button>
        </View>
      )}

      {error ? (
        <BodyText size={13} tone={color.danger}>{error}</BodyText>
      ) : null}
    </Screen>
  );
}

function Field({ label, value, onChange, placeholder, secure, keyboardType }: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  secure?: boolean;
  keyboardType?: 'url' | 'default';
}) {
  return (
    <View style={{ gap: space[1] }}>
      <Label>{label}</Label>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={color.stone}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry={secure}
        keyboardType={keyboardType === 'url' ? 'url' : 'default'}
        style={[body(15, 400), styles.input]}
      />
    </View>
  );
}

/** Accepts `herald.example.com` as readily as a full URL. */
function normalizeUrl(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, '');
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  // A bare host on the local network is almost certainly plain HTTP; anything
  // else is almost certainly not.
  const isLocal = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(trimmed);
  return `${isLocal ? 'http' : 'https'}://${trimmed}`;
}

const styles = StyleSheet.create({
  input: {
    borderWidth: 1,
    borderColor: color.line,
    color: color.bone,
    paddingHorizontal: space[2],
    paddingVertical: 12,
    minHeight: 44,
  },
  scanner: { flex: 1, backgroundColor: color.onyx },
  scannerOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[3],
    padding: space[3],
  },
  reticle: {
    width: 220,
    height: 220,
    borderWidth: 1,
    borderColor: color.gold,
  },
});
