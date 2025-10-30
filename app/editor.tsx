import React, {useMemo, useState, useRef, useEffect} from 'react';
import {Dimensions, StyleSheet, View, Pressable, Text, ActivityIndicator, Platform, Image, Alert} from 'react-native';
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
    type SkPath,
} from '@shopify/react-native-skia';
import {MaterialIcons} from '@react-native-vector-icons/material-icons'

const {width: SCREEN_W} = Dimensions.get('window');
const CANVAS_H = SCREEN_W * 1.5;

interface Stroke {
    path: SkPath;
    color: string;
    width: number;
}

// 1. Create a new component for the editor UI and logic.
// This component will only be rendered when Skia is ready.
const Editor = ({imageUri}: { imageUri?: string }) => {
    // Keep the original uri to support full reset
    const originalUriRef = useRef<string>(imageUri ?? '');
    // Working image uri that reflects applied crops
    const [currentUri, setCurrentUri] = useState<string>(imageUri ?? '');

    // All Skia-related hooks are now safely called here.
    const image = useImage(currentUri);

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

    // Thirds grid to render ABOVE CropZoom, sized by the same fixed container
    const ThirdsGrid = () => {
        const stroke = 'rgba(255,255,255,0.6)';
        return (
            <View pointerEvents="none" style={StyleSheet.absoluteFillObject}>
                <Svg width="100%" height="100%">
                    {/* Vertical thirds */}
                    <Line x1="33.333%" y1="0%" x2="33.333%" y2="100%" stroke={stroke} strokeWidth={1} />
                    <Line x1="66.666%" y1="0%" x2="66.666%" y2="100%" stroke={stroke} strokeWidth={1} />
                    {/* Horizontal thirds */}
                    <Line x1="0%" y1="33.333%" x2="100%" y2="33.333%" stroke={stroke} strokeWidth={1} />
                    <Line x1="0%" y1="66.666%" x2="100%" y2="66.666%" stroke={stroke} strokeWidth={1} />
                </Svg>
            </View>
        );
    };

    const [strokes, setStrokes] = useState<Stroke[]>([]);
    const [activePath, setActivePath] = useState<SkPath | null>(null);

    const [activeTool, setActiveTool] = useState('grid');
    const [applyingCrop, setApplyingCrop] = useState(false);

    const [brushWidth, setBrushWidth] = useState(6);
    const [brushColor, setBrushColor] = useState('#ff3b30');

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

    const resetEditor = () => {
        // Restore original image and clear drawings
        setCurrentUri(originalUriRef.current);
        setStrokes([]);
        setActivePath(null);
        // If grid tool is mounted, reset its transform state
        cropRef.current?.reset?.();
    };

    const confirmReset = () => {
        const canReset = strokes.length > 0 || currentUri !== originalUriRef.current;
        if (!canReset) return; // nothing to reset
        Alert.alert(
            'Reset editor?',
            'This will discard all drawings and revert the image to its original state.',
            [
                {text: 'Cancel', style: 'cancel'},
                {text: 'Reset', style: 'destructive', onPress: resetEditor},
            ]
        );
    };


    return (
        <View style={styles.container}>
            <View style={styles.canvasWrap}>
                {activeTool === 'grid' ? (
                    resolvedResolution === undefined ? (
                        <View
                            style={{width: SCREEN_W, height: CANVAS_H, alignItems: 'center', justifyContent: 'center'}}>
                            <ActivityIndicator size="large" color="#fff"/>
                        </View>
                    ) : (
                        <View style={{ width: SCREEN_W, height: CANVAS_H }}>
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
                            <ThirdsGrid />
                        </View>
                    )
                ) : (
                    <GestureDetector gesture={pan}>
                        <Canvas style={{width: SCREEN_W, height: CANVAS_H}}>
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
                            {['#ff3b30', '#34c759', '#0a84ff', '#ffd60a', '#ffffff'].map((c) => (
                                <Pressable
                                    key={c}
                                    onPress={() => setBrushColor(c)}
                                    style={[styles.colorSwatch, {backgroundColor: c}, brushColor === c && styles.colorSwatchActive]}
                                />
                            ))}
                            {[4, 6, 10, 14].map((w) => (
                                <Pressable key={w} onPress={() => setBrushWidth(w)} style={styles.widthBtn}>
                                    <View style={{height: w, width: 28, backgroundColor: '#fff', borderRadius: 12}}/>
                                </Pressable>
                            ))}
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
                </View>
            </View>
            <View style={styles.toolbar}>

                <Pressable style={styles.toolBtn} onPress={undo} disabled={strokes.length === 0}>
                    <Text style={[styles.toolText, strokes.length === 0 && {opacity: 0.5}]}>Undo</Text>
                </Pressable>
                <Pressable style={styles.toolBtn} onPress={clear} disabled={strokes.length === 0}>
                    <Text style={[styles.toolText, strokes.length === 0 && {opacity: 0.5}]}>Clear</Text>
                </Pressable>
                <Pressable
                    style={styles.toolBtn}
                    onPress={confirmReset}
                    disabled={strokes.length === 0 && currentUri === originalUriRef.current}
                >
                    <Text
                        style={[styles.toolText, (strokes.length === 0 && currentUri === originalUriRef.current) && {opacity: 0.5}]}>Reset</Text>
                </Pressable>
            </View>

        </View>
    );
};

// 2. The main screen component now only handles loading.
export default function EditorScreen() {
    const params = useLocalSearchParams<{ imageUri?: string }>();

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
            <Stack.Screen options={{headerShown: true, title: 'Editor'}}/>
            <Editor imageUri={params?.imageUri as string | undefined}/>
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
    colorSwatch: {height: 28, width: 28, borderRadius: 14, borderWidth: 2, borderColor: 'rgba(255,255,255,0.6)'},
    colorSwatchActive: {borderColor: '#fff', borderWidth: 3},
    widthBtn: {paddingHorizontal: 8, paddingVertical: 6, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 8},
});