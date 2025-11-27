import React, {useState, useRef, useEffect, useImperativeHandle} from 'react';
import {
    Dimensions,
    StyleSheet,
    View,
    Pressable,
    Text,
    TextInput,
    ActivityIndicator,
    Platform,
    Image,
    Alert,
    ScrollView,
    Keyboard,
    KeyboardAvoidingView,
    TouchableWithoutFeedback,
    Modal
} from 'react-native';
import Svg, {Line} from 'react-native-svg';
import {useLocalSearchParams, Stack} from 'expo-router';
import {Gesture, GestureDetector} from 'react-native-gesture-handler';
import {CropZoom, useImageResolution, type CropZoomRefType} from 'react-native-zoom-toolkit';
import {runOnJS} from 'react-native-reanimated';
import {manipulateAsync, FlipType, SaveFormat} from 'expo-image-manipulator';
import {
    Canvas,
    Image as SkiaImage,
    useImage,
    Path as SkiaPath,
    Skia,
    Group,
    useCanvasRef,
    type SkPath,
} from '@shopify/react-native-skia';
import {MaterialIcons} from '@react-native-vector-icons/material-icons'
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import {ensurePreviewDir, saveSession, getSession, updateSession, type EditorState} from '@/lib/sessions';

const {width: SCREEN_W} = Dimensions.get('window');
const CANVAS_H = SCREEN_W * 1.5;

interface Stroke {
    path: SkPath;
    color: string;
    width: number;
}

// 1. Create a new component for the editor UI and logic.
// This component will only be rendered when Skia is ready.
const Editor = React.forwardRef(({imageUri, initialState}: { imageUri?: string; initialState?: EditorState }, ref: React.Ref<{ openSaveDialog: () => void; saveWithoutPrompt: (sessionId: number) => Promise<void> }>) => {
    // Keep the original uri to support full reset
    const originalUriRef = useRef<string>(imageUri ?? '');
    // Working image uri that reflects applied crops
    const [currentUri, setCurrentUri] = useState<string>(imageUri ?? '');

    // All Skia-related hooks are now safely called here.
    const image = useImage(currentUri);

    // Hydrate from an initial saved state when provided
    useEffect(() => {
        if (initialState) {
            try {
                originalUriRef.current = initialState.originalUri || initialState.currentUri;
                setCurrentUri(initialState.currentUri || initialState.originalUri);
                setNoteText(initialState.noteText ?? '');
                const restored: Stroke[] = [];
                if (Array.isArray(initialState.strokes)) {
                    for (const s of initialState.strokes) {
                        const p = (Skia as any).Path?.MakeFromSVGString
                            ? (Skia as any).Path.MakeFromSVGString(s.pathSvg)
                            : null;
                        if (p) restored.push({ path: p, color: s.color, width: s.width });
                    }
                }
                setStrokes(restored);
                setActivePath(null);
                setActiveTool('none');
            } catch (e) {
                console.warn('Failed to hydrate editor state', e);
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [initialState?.currentUri]);

    // Ref to capture the canvas as an image for sharing
    const canvasRef = useCanvasRef();

    // CropZoom setup for grid tool
    const cropRef = useRef<CropZoomRefType>(null);
    const cropSize = {width: SCREEN_W, height: CANVAS_H};

    // Robust resolution resolver with fallback + cache (handles file:// URIs)
    const resolutionCacheRef = useRef<Record<string, { width: number; height: number }>>({});
    const {resolution: hookResolution} = useImageResolution({uri: currentUri});
    const [fallbackResolution, setFallbackResolution] = useState<{
        width: number;
        height: number
    } | undefined>(undefined);

    useEffect(() => {
        // Cache successful hook resolutions
        if (hookResolution && currentUri) {
            resolutionCacheRef.current[currentUri] = hookResolution;
            setFallbackResolution(undefined);
        }
    }, [hookResolution, currentUri]);

    useEffect(() => {
        // If hook didn't resolve (common with some local URIs), try Image.getSize
        if (!hookResolution && currentUri) {
            if (resolutionCacheRef.current[currentUri]) {
                setFallbackResolution(resolutionCacheRef.current[currentUri]);
                return;
            }
            Image.getSize(
                currentUri,
                (width, height) => {
                    const res = {width, height};
                    resolutionCacheRef.current[currentUri] = res;
                    setFallbackResolution(res);
                },
                () => {
                    // Keep undefined; CropZoom won't render until we have a resolution
                    setFallbackResolution(undefined);
                }
            );
        }
    }, [hookResolution, currentUri]);

    const resolvedResolution = hookResolution || fallbackResolution || resolutionCacheRef.current[currentUri];

    useImperativeHandle(ref, () => ({
        openSaveDialog: () => setSaveVisible(true),
        saveWithoutPrompt: async (sessionId: number) => {
            try {
                setSaving(true);
                // If currently in grid, apply crop to bake state
                if (activeTool === 'grid') {
                    await applyCropAndSwitch('none');
                    await new Promise((r)=>requestAnimationFrame(()=>r(null)));
                }
                // Ensure canvas has latest frame
                await new Promise((r)=>requestAnimationFrame(()=>r(null)));
                let previewUri: string | undefined = undefined;
                if (canvasRef.current) {
                    const snapshot = canvasRef.current.makeImageSnapshot();
                    const base64 = snapshot?.encodeToBase64 ? snapshot.encodeToBase64() : undefined;
                    if (base64) {
                        const dir = await ensurePreviewDir();
                        const out = `${dir}preview-${Date.now()}.png`;
                        await FileSystem.writeAsStringAsync(out, base64, {encoding: FileSystem.EncodingType.Base64});
                        previewUri = out;
                    }
                }
                const serializedStrokes = strokes.map((s)=>({
                    pathSvg: (s.path as any)?.toSVGString ? (s.path as any).toSVGString() : '',
                    color: s.color,
                    width: s.width,
                }));
                const state: EditorState = {
                    originalUri: originalUriRef.current,
                    currentUri,
                    noteText,
                    strokes: serializedStrokes,
                    canvas: { width: SCREEN_W, height: CANVAS_H },
                };
                await updateSession(sessionId, state, previewUri);
                Alert.alert('Updated', 'Your session has been updated.');
            } catch (e) {
                console.warn('Update session failed', e);
                Alert.alert('Save failed', 'Could not update your session.');
            } finally {
                setSaving(false);
            }
        },
    }));

    // Thirds grid to render ABOVE CropZoom, sized by the same fixed container
    const ThirdsGrid = () => {
        const stroke = 'rgba(255,255,255,0.6)';
        return (
            <View pointerEvents="none" style={StyleSheet.absoluteFillObject}>
                <Svg width="100%" height="100%">
                    {/* Vertical thirds */}
                    <Line x1="33.333%" y1="0%" x2="33.333%" y2="100%" stroke={stroke} strokeWidth={1}/>
                    <Line x1="66.666%" y1="0%" x2="66.666%" y2="100%" stroke={stroke} strokeWidth={1}/>
                    {/* Horizontal thirds */}
                    <Line x1="0%" y1="33.333%" x2="100%" y2="33.333%" stroke={stroke} strokeWidth={1}/>
                    <Line x1="0%" y1="66.666%" x2="100%" y2="66.666%" stroke={stroke} strokeWidth={1}/>
                </Svg>
            </View>
        );
    };

    const [strokes, setStrokes] = useState<Stroke[]>([]);
    const [activePath, setActivePath] = useState<SkPath | null>(null);

    const [activeTool, setActiveTool] = useState('grid');
    const [applyingCrop, setApplyingCrop] = useState(false);

    const [brushWidth, setBrushWidth] = useState(6);
    const [brushColor, setBrushColor] = useState('#aaa');
    const [exporting, setExporting] = useState(false);
    // Save modal state
    const [saveVisible, setSaveVisible] = useState(false);
    const [saveName, setSaveName] = useState('');
    const [saving, setSaving] = useState(false);
    // Notes state
    const [noteText, setNoteText] = useState('');
    // Brush UI state
    const COLORS = ['#fff', '#e2e2e2', '#c6c6c6', '#aaa', '#8f8f8f', '#757575', '#5b5b5b', '#434343', '#2d2d2d', '#181818', '#000'];
    const WIDTHS = [2, 4, 6, 8, 10, 12, 14, 18, 22, 26];
    const [showColorOptions, setShowColorOptions] = useState(false);
    const [showWidthOptions, setShowWidthOptions] = useState(false);

    // Collapse brush option panels when leaving brush tool
    useEffect(() => {
        if (activeTool !== 'brush') {
            setShowColorOptions(false);
            setShowWidthOptions(false);
        }
    }, [activeTool]);

    // Apply crop and switch tool
    const applyCropAndSwitch = async (nextTool: string) => {
        if (!cropRef.current) {
            setActiveTool(nextTool);
            return;
        }
        try {
            setApplyingCrop(true);
            // Use fixed width equal to canvas width to control output size
            const resultCtx = cropRef.current.crop(SCREEN_W);
            const actions: any[] = [];
            if (resultCtx.resize) {
                actions.push({
                    resize: {
                        width: Math.round(resultCtx.resize.width),
                        height: Math.round(resultCtx.resize.height)
                    }
                });
            }
            const angle = Math.round(resultCtx.context.rotationAngle);
            const normAngle = ((angle % 360) + 360) % 360;
            if (normAngle !== 0) {
                actions.push({rotate: normAngle});
            }
            if (resultCtx.context.flipHorizontal) {
                actions.push({flip: FlipType.Horizontal});
            }
            if (resultCtx.context.flipVertical) {
                actions.push({flip: FlipType.Vertical});
            }
            // Crop must be last
            actions.push({
                crop: {
                    originX: Math.round(resultCtx.crop.originX),
                    originY: Math.round(resultCtx.crop.originY),
                    width: Math.round(resultCtx.crop.width),
                    height: Math.round(resultCtx.crop.height),
                }
            });

            const manipulated = await manipulateAsync(
                currentUri,
                actions,
                {compress: 1, format: SaveFormat.PNG}
            );

            setCurrentUri(manipulated.uri);
            // Clear existing strokes after crop as requested
            setStrokes([]);
            setActivePath(null);
            setActiveTool(nextTool);
        } catch (e) {
            console.warn('Failed to apply crop', e);
            // Even if it fails, switch tool to avoid UX dead-ends
            setActiveTool(nextTool);
        } finally {
            setApplyingCrop(false);
        }
    };

    const onSelectTool = (tool: string) => {
        if (activeTool === 'grid' && tool !== 'grid') {
            // Leaving grid: auto-apply crop
            applyCropAndSwitch(tool);
        } else {
            // If leaving notes, make sure to hide the keyboard
            if (activeTool === 'note' && tool !== 'note') {
                Keyboard.dismiss();
            }
            setActiveTool(tool);
        }
    };


    // JS-side handlers to avoid calling React state setters from gesture worklets
    const startStroke = (x: number, y: number) => {
        const p = Skia.Path.Make();
        p.moveTo(x, y);
        setActivePath(p);
    };
    const appendPoint = (x: number, y: number) => {
        setActivePath((prev) => {
            if (!prev) return prev;
            prev.lineTo(x, y);
            return prev.copy();
        });
    };
    const endStroke = () => {
        setActivePath((prev) => {
            if (prev) {
                setStrokes((s) => [...s, {path: prev, color: brushColor, width: brushWidth}]);
            }
            return null;
        });
    };

    const pan = Gesture.Pan()
        .onStart((e) => {
            runOnJS(startStroke)(e.x, e.y);
        })
        .onChange((e) => {
            runOnJS(appendPoint)(e.x, e.y);
        })
        .onEnd(() => {
            runOnJS(endStroke)();
        });

    const undo = () => setStrokes((prev) => prev.slice(0, -1));
    const clear = () => {
        setStrokes([]);
        setActivePath(null);
    };

    const exportAndShare = async () => {
        try {
            if (!canvasRef.current) {
                Alert.alert('Not ready', 'Canvas is not ready yet.');
                return;
            }
            setExporting(true);
            // Ensure the canvas has rendered latest frame
            await new Promise((r) => requestAnimationFrame(() => r(null)));
            const imageSnapshot = canvasRef.current.makeImageSnapshot();
            if (!imageSnapshot) {
                Alert.alert('Export failed', 'Could not capture the canvas.');
                return;
            }
            // Use no-arg encodeToBase64 which defaults to PNG on all supported Skia versions
            const base64 = imageSnapshot.encodeToBase64
                ? imageSnapshot.encodeToBase64()
                : undefined;
            if (!base64) {
                Alert.alert('Export failed', 'Encoding snapshot failed.');
                return;
            }
            const fileUri = `${FileSystem.cacheDirectory}chromaframe-${Date.now()}.png`;
            await FileSystem.writeAsStringAsync(fileUri, base64, {encoding: FileSystem.EncodingType.Base64});
            const available = await Sharing.isAvailableAsync();
            if (!available) {
                Alert.alert('Sharing not available', 'Sharing is not available on this device. The image was saved to a temporary file.', [
                    {text: 'OK'}
                ]);
                return;
            }
            await Sharing.shareAsync(fileUri, {
                mimeType: 'image/png',
                dialogTitle: 'Share image',
            });
        } catch (e) {
            console.warn('Share failed', e);
            Alert.alert('Share failed', 'Something went wrong while preparing the image.');
        } finally {
            setExporting(false);
        }
    };

    const onPressShare = async () => {
        if (activeTool === 'grid') {
            Alert.alert(
                'Apply crop?',
                'To share, we need to apply your current crop first.',
                [
                    {text: 'Cancel', style: 'cancel'},
                    {
                        text: 'Apply & Share', onPress: async () => {
                            await applyCropAndSwitch('share');
                            // Wait a tick for canvas to update
                            setTimeout(() => exportAndShare(), 50);
                        }
                    }
                ]
            );
            return;
        }
        await exportAndShare();
    };

    const resetEditor = () => {
        // Restore original image and clear drawings
        setCurrentUri(originalUriRef.current);
        setStrokes([]);
        setActivePath(null);
        // If grid tool is mounted, reset its transform state
        cropRef.current?.reset?.();
    };


    return (
        <View style={styles.container}>
            <View style={styles.canvasWrap}>
                {activeTool === 'note' ? (
                    <KeyboardAvoidingView
                        style={{width: SCREEN_W, height: CANVAS_H, padding: 16}}
                        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                    >
                        <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
                            <View style={{flex: 1}}>
                                <Text style={{color: '#fff', fontSize: 16, fontWeight: '600', marginBottom: 8}}>Notes</Text>
                                <TextInput
                                    style={{flex: 1, color: '#fff', backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 12, padding: 12, textAlignVertical: 'top'}}
                                    multiline
                                    placeholder="Type your notes here..."
                                    placeholderTextColor="rgba(255,255,255,0.6)"
                                    value={noteText}
                                    onChangeText={setNoteText}
                                    blurOnSubmit
                                    returnKeyType="done"
                                />
                            </View>
                        </TouchableWithoutFeedback>
                    </KeyboardAvoidingView>
                ) : activeTool === 'grid' ? (
                    resolvedResolution === undefined ? (
                        <View
                            style={{width: SCREEN_W, height: CANVAS_H, alignItems: 'center', justifyContent: 'center'}}>
                            <ActivityIndicator size="large" color="#fff"/>
                        </View>
                    ) : (
                        <View style={{width: SCREEN_W, height: CANVAS_H}}>
                            <CropZoom
                                key={`cz-${currentUri}`}
                                ref={cropRef}
                                cropSize={cropSize}
                                resolution={resolvedResolution}
                            >
                                <Image
                                    source={{uri: currentUri}}
                                    style={{width: '100%', height: '100%'}}
                                    resizeMode="cover"
                                />
                            </CropZoom>
                            <ThirdsGrid/>
                        </View>
                    )
                ) : (
                    <GestureDetector gesture={pan}>
                        <Canvas ref={canvasRef} style={{width: SCREEN_W, height: CANVAS_H}}>
                            {image && <SkiaImage key={`sk-${currentUri}`} image={image} x={0} y={0} width={SCREEN_W}
                                                 height={CANVAS_H} fit="cover"/>}
                            {strokes.map((s, idx) => (
                                <SkiaPath key={idx} path={s.path} color={s.color} style="stroke" strokeWidth={s.width}/>
                            ))}
                            {activePath && (
                                <SkiaPath path={activePath} color={brushColor} style="stroke" strokeWidth={brushWidth}/>
                            )}
                        </Canvas>
                    </GestureDetector>
                )}
            </View>

            <View>

                {
                    activeTool === 'brush' && (

                        <View style={styles.brushRow}>
                            {/* Color selector: collapsed to active color, expand on tap */}
                            <View style={styles.rowSection}>
                                <View style={{flexDirection: 'row', alignItems: 'center'}}>
                                    <Pressable onPress={() => setShowColorOptions(v => !v)}>
                                        <View
                                            style={[styles.colorSwatch, {backgroundColor: brushColor}, styles.colorSwatchActive]}/>
                                    </Pressable>
                                    {showColorOptions && (
                                        <ScrollView
                                            horizontal
                                            showsHorizontalScrollIndicator={false}
                                            style={{flex: 1}}
                                            contentContainerStyle={{alignItems: 'center'}}
                                        >
                                            {COLORS.map((c) => (
                                                <Pressable
                                                    key={c}
                                                    onPress={() => {
                                                        setBrushColor(c);
                                                        setShowColorOptions(false);
                                                    }}
                                                    style={[styles.colorSwatch, {backgroundColor: c}, brushColor === c && styles.colorSwatchActive]}
                                                />
                                            ))}
                                        </ScrollView>
                                    )}
                                </View>
                            </View>

                            {/* Width selector: gesture adjust and optional list on tap */}
                            <View style={styles.rowSection}>
                                <View style={{flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end'}}>
                                    {showWidthOptions && (
                                        <ScrollView
                                            horizontal
                                            showsHorizontalScrollIndicator={false}
                                            style={{flex: 1}}
                                            contentContainerStyle={{alignItems: 'center', justifyContent: 'flex-end'}}
                                        >
                                            {WIDTHS.map((w) => (
                                                <Pressable key={w} onPress={() => {
                                                    setBrushWidth(w);
                                                    setShowWidthOptions(false);
                                                }} style={styles.widthBtn}>
                                                    <View style={{
                                                        height: w,
                                                        width: 28,
                                                        backgroundColor: '#fff',
                                                        borderRadius: 12
                                                    }}/>
                                                </Pressable>
                                            ))}
                                        </ScrollView>
                                    )}
                                    <Pressable onPress={() => setShowWidthOptions(v => !v)}>
                                        <View style={styles.widthPreviewWrap}>
                                            <View style={[styles.widthPreviewBar, {height: brushWidth}]}/>
                                            <Text style={styles.widthPreviewText}>{brushWidth}</Text>
                                        </View>
                                    </Pressable>
                                </View>
                            </View>
                            <Pressable style={styles.toolBtn} onPress={undo} disabled={strokes.length === 0}>
                                <MaterialIcons name="undo" size={24} color="#fff"/>
                            </Pressable>
                            <Pressable style={styles.toolBtn} onPress={clear} disabled={strokes.length === 0}>
                                <MaterialIcons name="layers-clear" size={24} color="#fff"/>
                            </Pressable>
                        </View>
                    )
                }



                <View style={styles.toolbar}>
                    <Pressable style={styles.toolBtn}
                               onPress={() => onSelectTool(activeTool === 'grid' ? 'none' : 'grid')}>
                        <MaterialIcons name="grid-on" size={24} color={activeTool === 'grid' ? '#ffd60a' : '#fff'}/>
                    </Pressable>
                    <Pressable style={styles.toolBtn}
                               onPress={() => onSelectTool(activeTool === 'brush' ? 'none' : 'brush')}>
                        <MaterialIcons name="brush" size={24} color={activeTool === 'brush' ? '#ffd60a' : '#fff'}/>
                    </Pressable>
                    <Pressable style={styles.toolBtn}
                               onPress={() => onSelectTool(activeTool === 'picker' ? 'none' : 'picker')}>
                        <MaterialIcons name="colorize" size={24} color={activeTool === 'picker' ? '#ffd60a' : '#fff'}/>
                    </Pressable>
                    <Pressable style={styles.toolBtn}
                               onPress={() => onSelectTool(activeTool === 'note' ? 'none' : 'note')}>
                        <MaterialIcons name="note-add" size={24}
                                       color={activeTool === 'note' ? '#ffd60a' : '#fff'}/>
                    </Pressable>
                    <Pressable style={styles.toolBtn}
                               onPress={onPressShare}
                               disabled={exporting || applyingCrop || activeTool === 'note'}>
                        {exporting ? (
                            <ActivityIndicator color="#fff"/>
                        ) : (
                            <MaterialIcons name="ios-share" size={24} color="#fff"/>
                        )}
                    </Pressable>
                </View>
            </View>
            <View style={styles.toolbar}>
            </View>

            {/* Save Session Modal */}
            <Modal visible={saveVisible} transparent animationType="fade" onRequestClose={() => setSaveVisible(false)}>
                <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
                    <View style={{flex:1, backgroundColor:'rgba(0,0,0,0.6)', justifyContent:'center', alignItems:'center', padding:24}}>
                        <View style={{width:'100%', backgroundColor:'#111', borderRadius:12, padding:16}}>
                            <Text style={{color:'#fff', fontSize:18, fontWeight:'700', marginBottom:12}}>Save session</Text>
                            <TextInput
                                value={saveName}
                                onChangeText={setSaveName}
                                placeholder="Name your session"
                                placeholderTextColor="rgba(255,255,255,0.5)"
                                style={{color:'#fff', backgroundColor:'rgba(255,255,255,0.06)', borderRadius:8, padding:12}}
                            />
                            <View style={{flexDirection:'row', justifyContent:'flex-end', gap:12, marginTop:16}}>
                                <Pressable onPress={() => setSaveVisible(false)} style={{paddingHorizontal:12, paddingVertical:8}}>
                                    <Text style={{color:'#fff'}}>Cancel</Text>
                                </Pressable>
                                <Pressable disabled={saving || !saveName.trim()} onPress={async () => {
                                    try {
                                        const name = saveName.trim();
                                        if (!name) return;
                                        setSaving(true);
                                        // If currently in grid, apply crop to bake state
                                        if (activeTool === 'grid') {
                                            await applyCropAndSwitch('none');
                                            // wait next frame
                                            await new Promise((r)=>requestAnimationFrame(()=>r(null)));
                                        }
                                        // Ensure canvas has latest frame
                                        await new Promise((r)=>requestAnimationFrame(()=>r(null)));
                                        let previewUri: string | null = null;
                                        if (canvasRef.current) {
                                            const snapshot = canvasRef.current.makeImageSnapshot();
                                            const base64 = snapshot?.encodeToBase64 ? snapshot.encodeToBase64() : undefined;
                                            if (base64) {
                                                const dir = await ensurePreviewDir();
                                                const out = `${dir}preview-${Date.now()}.png`;
                                                await FileSystem.writeAsStringAsync(out, base64, {encoding: FileSystem.EncodingType.Base64});
                                                previewUri = out;
                                            }
                                        }
                                        // Serialize strokes to SVG strings
                                        const serializedStrokes = strokes.map((s)=>({
                                            pathSvg: (s.path as any)?.toSVGString ? (s.path as any).toSVGString() : '',
                                            color: s.color,
                                            width: s.width,
                                        }));
                                        const state: EditorState = {
                                            originalUri: originalUriRef.current,
                                            currentUri,
                                            noteText,
                                            strokes: serializedStrokes,
                                            canvas: { width: SCREEN_W, height: CANVAS_H },
                                        };
                                        await saveSession(name, state, previewUri);
                                        setSaveVisible(false);
                                        setSaveName('');
                                        Alert.alert('Saved', 'Your session has been saved.');
                                    } catch (e) {
                                        console.warn('Save session failed', e);
                                        Alert.alert('Save failed', 'Could not save your session.');
                                    } finally {
                                        setSaving(false);
                                    }
                                }} style={{paddingHorizontal:12, paddingVertical:8, backgroundColor: saving || !saveName.trim() ? 'rgba(255,255,255,0.2)' : '#fff', borderRadius:8}}>
                                    <Text style={{color: saving || !saveName.trim() ? 'rgba(255,255,255,0.7)' : '#111', fontWeight:'700'}}>{saving ? 'Saving…' : 'Save'}</Text>
                                </Pressable>
                            </View>
                        </View>
                    </View>
                </TouchableWithoutFeedback>
            </Modal>

        </View>
    );
});

// 2. The main screen component now only handles loading.
export default function EditorScreen() {
    const editorRef = useRef<{ openSaveDialog: () => void; saveWithoutPrompt: (sessionId: number) => Promise<void> }>(null);
    const params = useLocalSearchParams<{ imageUri?: string; sessionId?: string }>();
    const [initialState, setInitialState] = useState<EditorState | undefined>(undefined);
    const [loadingSession, setLoadingSession] = useState(false);

    useEffect(() => {
        (async () => {
            if (params?.sessionId) {
                try {
                    setLoadingSession(true);
                    const row = await getSession(Number(params.sessionId));
                    if (row?.state_json) {
                        const parsed: EditorState = JSON.parse(row.state_json);
                        setInitialState(parsed);
                    }
                } catch (e) {
                    console.warn('Failed to load session', e);
                    Alert.alert('Load failed', 'Could not open the saved session.');
                } finally {
                    setLoadingSession(false);
                }
            }
        })();
    }, [params?.sessionId]);

    // Ensure Skia and Skia.Path are available and avoid rendering on web.
    const isSkiaReady = Platform.OS !== 'web' && !!Skia && !!(Skia as any).Path;
    if (!isSkiaReady) {
        return (
            <View style={styles.container}>
                <Stack.Screen options={{headerShown: true, title: 'Editor'}}/>
                <View style={[styles.canvasWrap, {padding: 24}]}>
                    <ActivityIndicator size="large" color="#fff"/>
                    <Text style={{color: '#fff', opacity: 0.8, marginTop: 12, textAlign: 'center'}}>
                        The editor is not available on web yet. Please use a native device or simulator.
                    </Text>
                </View>
            </View>
        );
    }

    return (
        <>
            <Stack.Screen options={{headerShown: true, title: 'Editor', headerRight: () => (
                <Pressable onPress={() => {
                    if (params?.sessionId) {
                        const idNum = Number(params.sessionId);
                        if (!Number.isNaN(idNum)) {
                            editorRef.current?.saveWithoutPrompt(idNum);
                        } else {
                            editorRef.current?.openSaveDialog();
                        }
                    } else {
                        editorRef.current?.openSaveDialog();
                    }
                }} style={{paddingHorizontal:12}}>
                    <MaterialIcons name="save" size={24} color={Platform.OS === 'ios' ? '#007aff' : '#fff'} />
                </Pressable>
            )}}/>
            {loadingSession && params?.sessionId ? (
                <View style={[styles.canvasWrap, {padding: 24}]}> 
                    <ActivityIndicator size="large" color="#fff" />
                    <Text style={{color:'#fff', opacity:0.8, marginTop:12}}>Loading session…</Text>
                </View>
            ) : (
                <Editor ref={editorRef} imageUri={params?.imageUri as string | undefined} initialState={initialState} />
            )}
        </>
    );
}

const styles = StyleSheet.create({
    container: {flex: 1, backgroundColor: '#000', justifyContent: 'center'},
    canvasWrap: {flex: 1, alignItems: 'center', justifyContent: 'center', position: 'relative'},
    toolbar: {
        flexDirection: 'row',
        justifyContent: 'space-around',
        paddingVertical: 12,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: 'rgba(255,255,255,0.2)',
    },
    toolBtn: {paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.1)'},
    toolText: {color: '#fff', fontWeight: '600'},
    brushRow: {
        flexDirection: 'row',
        gap: 12,
        padding: 12,
        alignItems: 'center',
        justifyContent: 'space-evenly',
    },
    rowSection: {flex: 1, minWidth: 0},
    scrollRow: {marginTop: 8},
    colorSwatch: {
        height: 28,
        width: 28,
        borderRadius: 14,
        borderWidth: 2,
        borderColor: 'rgba(255,255,255,0.6)',
        marginRight: 8
    },
    colorSwatchActive: {borderColor: '#fff', borderWidth: 3},
    widthBtn: {
        paddingHorizontal: 8,
        paddingVertical: 6,
        backgroundColor: 'rgba(255,255,255,0.08)',
        borderRadius: 8,
        marginRight: 8
    },
    widthPreviewWrap: {alignItems: 'center', justifyContent: 'center', paddingVertical: 4, paddingHorizontal: 8},
    widthPreviewBar: {width: 28, backgroundColor: '#fff', borderRadius: 12},
    widthPreviewText: {color: '#fff', fontSize: 12, opacity: 0.8, marginTop: 4, textAlign: 'center'},
    adjustTrack: {
        height: 24,
        borderRadius: 12,
        backgroundColor: 'rgba(255,255,255,0.12)',
        width: 140,
        marginTop: 6,
        overflow: 'hidden'
    },
    adjustFill: {position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: 'rgba(255,255,255,0.35)'},
    adjustThumb: {
        position: 'absolute',
        top: 0,
        width: 16,
        height: 24,
        borderRadius: 8,
        backgroundColor: '#fff',
        marginLeft: -8
    },
});