import {Tabs, useRouter} from 'expo-router';
import React, {useCallback, useMemo, useState} from 'react';
import {Modal, Pressable, View, Text, Platform, StyleSheet, Alert} from 'react-native';
import * as ImagePicker from 'expo-image-picker';

import {HapticTab} from '@/components/haptic-tab';
import {IconSymbol} from '@/components/ui/icon-symbol';
import {Colors} from '@/constants/theme';
import {useColorScheme} from '@/hooks/use-color-scheme';

export default function TabLayout() {
    const colorScheme = useColorScheme();
    const router = useRouter();
    const [sheetOpen, setSheetOpen] = useState(false);
    const [processing, setProcessing] = useState(false);

    const tint = Colors[colorScheme ?? 'light'].tint;
    const tabIconSelected = Colors[colorScheme ?? 'light'].tabIconSelected;
    const bg = useMemo(() => (colorScheme === 'dark' ? '#111' : '#fff'), [colorScheme]);
    const fg = useMemo(() => (colorScheme === 'dark' ? '#fff' : '#111'), [colorScheme]);
    const border = useMemo(() => (colorScheme === 'dark' ? '#222' : '#e5e5e5'), [colorScheme]);

    const onPick = useCallback(async () => {
        try {
            if (Platform.OS === 'web') {
                Alert.alert('Not supported on web', 'Please use a native device or simulator to pick an image.');
                return;
            }
            setProcessing(true);
            const res = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ['images'],
                allowsEditing: false,
                quality: 1,
            });
            setProcessing(false);
            setSheetOpen(false);
            if (!res.canceled && res.assets?.[0]?.uri) {
                router.push({pathname: '/editor', params: {imageUri: res.assets[0].uri}});
            } else if (res.canceled) {
                // User canceled
            }
        } catch (e) {
            setProcessing(false);
            setSheetOpen(false);
            Alert.alert('Image Picker Error', 'Unable to open the photo library. Please try again.');
        }
    }, [router]);

    const onCamera = useCallback(async () => {
        try {
            if (Platform.OS === 'web') {
                Alert.alert('Not supported on web', 'Camera is not available on web. Use a native device or simulator.');
                return;
            }
            setProcessing(true);
            const perm = await ImagePicker.requestCameraPermissionsAsync();
            if (perm.status !== 'granted') {
                setProcessing(false);
                setSheetOpen(false);
                Alert.alert('Camera permission needed', 'Please allow camera access in Settings to take a photo.');
                return;
            }
            const res = await ImagePicker.launchCameraAsync({
                mediaTypes: 'images',
                allowsEditing: false,
                quality: 1,
            });
            setProcessing(false);
            setSheetOpen(false);
            if (!res.canceled && res.assets?.[0]?.uri) {
                router.push({pathname: '/editor', params: {imageUri: res.assets[0].uri}});
            }
        } catch (e) {
            setProcessing(false);
            setSheetOpen(false);
            Alert.alert('Camera Error', 'Unable to open the camera. Please try again.');
        }
    }, [router]);

    return (
        <>
            <Tabs
                screenOptions={{
                    tabBarActiveTintColor: tabIconSelected,
                    headerShown: false,
                    tabBarButton: HapticTab,
                }}>
                <Tabs.Screen
                    name="index"
                    options={{
                        title: 'Home',
                        tabBarIcon: ({color}) => <IconSymbol size={28} name="house.fill" color={color}/>,
                    }}
                />
                <Tabs.Screen
                    name="new"
                    options={{
                        tabBarLabel: () => null,
                        tabBarButton: () => (
                            <Pressable style={styles.centerButton} onPress={() => setSheetOpen(true)}>
                                <IconSymbol size={32} name="plus" color="#FFF"/>
                            </Pressable>
                        ),
                    }}
                />
                <Tabs.Screen
                    name="explore"
                    options={{
                        title: 'Explore',
                        tabBarIcon: ({color}) => <IconSymbol size={28} name="paperplane.fill" color={color}/>,
                    }}
                />
            </Tabs>


            {/* Minimal cross-platform ActionSheet-like modal (styled with current theme) */}
            <Modal transparent visible={sheetOpen} animationType="fade" onRequestClose={() => setSheetOpen(false)}>
                <Pressable style={styles.backdrop} onPress={() => !processing && setSheetOpen(false)}/>
                <View style={[styles.sheet, {backgroundColor: bg, borderColor: border}]}>
                    <View style={styles.grabber}/>
                    <Pressable style={styles.item} onPress={processing ? undefined : onPick}>
                        <Text style={[styles.itemText, {color: fg}]}>Import from Gallery</Text>
                    </Pressable>
                    <View style={[styles.separator, {backgroundColor: border}]}/>
                    <Pressable style={styles.item} onPress={processing ? undefined : onCamera}>
                        <Text style={[styles.itemText, {color: fg}]}>Open Camera</Text>
                    </Pressable>
                    <View style={[styles.separator, {backgroundColor: border}]}/>
                    <Pressable style={styles.item} onPress={() => setSheetOpen(false)}>
                        <Text style={[styles.itemText, {color: fg}]}>Cancel</Text>
                    </Pressable>
                    {Platform.OS !== 'web' && (
                        <Text
                            style={[styles.hint, {color: fg, opacity: 0.5}]}>{processing ? 'Processing...' : ''}</Text>
                    )}
                </View>
            </Modal>
        </>
    );
}

const styles = StyleSheet.create({
    centerButton: {
        // Position the button
        justifyContent: 'center',
        alignSelf: 'center',
        alignItems: 'center',
        // Style the button
        width: 48,
        height: 48,
        borderRadius: 30,
        backgroundColor: Colors.light.tint,
        // Add a shadow
        shadowColor: '#000',
        shadowOffset: {width: 0, height: 2},
        shadowOpacity: 0.25,
        shadowRadius: 3.84,
        elevation: 5,
    },
    backdrop: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0,0,0,0.4)',
    },
    sheet: {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        paddingBottom: 24,
        borderTopLeftRadius: 16,
        borderTopRightRadius: 16,
        borderWidth: StyleSheet.hairlineWidth,
    },
    grabber: {
        alignSelf: 'center',
        width: 40,
        height: 4,
        borderRadius: 2,
        backgroundColor: '#888',
        marginVertical: 8,
        opacity: 0.5,
    },
    item: {
        paddingVertical: 16,
        paddingHorizontal: 20,
    },
    itemText: {
        fontSize: 16,
        fontWeight: '600',
        textAlign: 'center',
    },
    separator: {
        width: '100%',
    },
    hint: {
        textAlign: 'center',
        marginTop: 8,
    },
});
