import React, {useMemo, useState} from 'react';
import {Dimensions, StyleSheet, View, Pressable, Text, ActivityIndicator, Platform} from 'react-native';
import {useLocalSearchParams, Stack} from 'expo-router';
import {Gesture, GestureDetector} from 'react-native-gesture-handler';
import {runOnJS} from 'react-native-reanimated';
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
    // All Skia-related hooks are now safely called here.
    const image = useImage(imageUri ?? '');

    const [strokes, setStrokes] = useState<Stroke[]>([]);
    const [activePath, setActivePath] = useState<SkPath | null>(null);

    const [activeTool, setActiveTool] = useState('grid');


    const [brushWidth, setBrushWidth] = useState(6);
    const [brushColor, setBrushColor] = useState('#ff3b30');


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

    const gridLines = useMemo(() => {
        const lines: { from: [number, number]; to: [number, number] }[] = [];
        const thirdW = SCREEN_W / 3;
        const thirdH = CANVAS_H / 3;
        // Vertical lines
        lines.push({from: [thirdW, 0], to: [thirdW, CANVAS_H]});
        lines.push({from: [thirdW * 2, 0], to: [thirdW * 2, CANVAS_H]});
        // Horizontal lines
        lines.push({from: [0, thirdH], to: [SCREEN_W, thirdH]});
        lines.push({from: [0, thirdH * 2], to: [SCREEN_W, thirdH * 2]});
        return lines;
    }, []);

    return (
        <View style={styles.container}>
            <View style={styles.canvasWrap}>
                <GestureDetector gesture={pan}>
                    <Canvas style={{width: SCREEN_W, height: CANVAS_H}}>
                        {image && <SkiaImage image={image} x={0} y={0} width={SCREEN_W} height={CANVAS_H} fit="cover"/>}
                        {activeTool === 'grid' && (
                            <Group>
                                {gridLines.map((l, idx) => (
                                    <SkiaPath
                                        key={idx}
                                        path={Skia.Path.Make().moveTo(l.from[0], l.from[1]).lineTo(l.to[0], l.to[1])}
                                        color="rgba(255,255,255,0.4)"
                                        style="stroke"
                                        strokeWidth={1}
                                    />
                                ))}
                            </Group>
                        )}
                        {strokes.map((s, idx) => (
                            <SkiaPath key={idx} path={s.path} color={s.color} style="stroke" strokeWidth={s.width}/>
                        ))}
                        {activePath && (
                            <SkiaPath path={activePath} color={brushColor} style="stroke" strokeWidth={brushWidth}/>
                        )}
                    </Canvas>
                </GestureDetector>
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
                               onPress={() => setActiveTool((v) => v === 'grid' ? 'none' : 'grid')}>
                        <MaterialIcons name="grid-on" size={24} color={activeTool === 'grid' ? '#ffd60a' : '#fff'}/>
                    </Pressable>
                    <Pressable style={styles.toolBtn} onPress={() =>
                        setActiveTool((v) => v === 'brush' ? 'none' : 'brush')}>


                        <MaterialIcons name="brush" size={24} color={activeTool === 'brush' ? '#ffd60a' : '#fff'}/>
                    </Pressable>
                    <Pressable style={styles.toolBtn}
                               onPress={() => setActiveTool((v) => v === 'picker' ? 'none' : 'picker')}>
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
    canvasWrap: {flex: 1, alignItems: 'center', justifyContent: 'center'},
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