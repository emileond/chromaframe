import React, {useCallback, useMemo, useState} from 'react';
import {
    Image,
    StyleSheet,
    View,
    Pressable,
    FlatList,
    Dimensions,
    ActionSheetIOS,
    Alert,
    Platform,
} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import {useRouter} from 'expo-router';
import * as Haptics from 'expo-haptics';

import {Card} from '@/components/ui/card';
import {Heading} from '@/components/ui/heading';
import {Text} from '@/components/ui/text';
import {ThemedView} from '@/components/themed-view';
import {EmptyState} from '@/components/empty-state';
import {listSessions, deleteSession, type SessionRow} from '@/lib/sessions';

const PADDING_H = 16;
const GAP = 12;

export default function HomeScreen() {
    const [sessions, setSessions] = useState<SessionRow[]>([]);
    const router = useRouter();

    const screenW = Dimensions.get('window').width;
    const ITEM_W = useMemo(() => Math.floor((screenW - PADDING_H * 2 - GAP) / 2), [screenW]);

    const refresh = useCallback(async () => {
        try {
            const rows = await listSessions();
            setSessions(rows);
        } catch {
            // ignore
        }
    }, []);

    useFocusEffect(
        useCallback(() => {
            let mounted = true;
            (async () => {
                try {
                    const rows = await listSessions();
                    if (mounted) setSessions(rows);
                } catch {
                    // ignore
                }
            })();
            return () => {
                mounted = false;
            };
        }, [])
    );

    const onLongPressItem = useCallback(async (s: SessionRow) => {
        // Light haptic feedback when opening options
        try {
            await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        } catch {
            // ignore haptics errors
        }

        const doDelete = async () => {
            try {
                await deleteSession(s.id);
                // Optimistic update
                setSessions(prev => prev.filter(x => x.id !== s.id));
            } catch (e) {
                Alert.alert('Delete failed', 'Could not delete the session.');
            }
        };

        if (Platform.OS === 'ios') {
            ActionSheetIOS.showActionSheetWithOptions(
                {
                    title: s.name,
                    options: ['Cancel', 'Delete'],
                    destructiveButtonIndex: 1,
                    cancelButtonIndex: 0,
                    userInterfaceStyle: 'dark',
                },
                (buttonIndex) => {
                    if (buttonIndex === 1) {
                        doDelete();
                    }
                }
            );
        } else {
            Alert.alert(
                s.name,
                undefined,
                [
                    {text: 'Cancel', style: 'cancel'},
                    {text: 'Delete', style: 'destructive', onPress: doDelete},
                ],
                {cancelable: true}
            );
        }
    }, []);

    const renderItem = useCallback(({item}: { item: SessionRow }) => (
        <Pressable
            onPress={() => router.push({pathname: '/editor', params: {sessionId: String(item.id)}})}
            onLongPress={() => onLongPressItem(item)}
            accessibilityRole="button"
            style={{width: ITEM_W}}
        >
            <Card size="md" variant="elevated" style={styles.cardBody}>
                {item.preview_uri ? (
                    <Image source={{uri: item.preview_uri}} style={styles.preview} resizeMode="cover"/>
                ) : (
                    <View style={styles.placeholder}/>
                )}
                <Text size="sm" className="mt-2 text-typography-600" numberOfLines={1}>
                    {item.name}
                </Text>
            </Card>
        </Pressable>
    ), [ITEM_W, onLongPressItem, router]);

    const keyExtractor = useCallback((it: SessionRow) => String(it.id), []);

    const emptyData = useMemo(() => Array.from({length: 4}).map((_, i) => ({id: -i - 1})), []);

    return (
        <ThemedView style={{flex: 1}}>
            <Heading size="xl" className="pt-16 pb-6 px-4">
                Welcome
            </Heading>

            <View style={{flex: 1}}>
                {sessions.length === 0 ? (
                    <EmptyState/>
                ) : (
                    <FlatList
                        data={sessions}
                        renderItem={renderItem}
                        keyExtractor={keyExtractor}
                        numColumns={2}
                        columnWrapperStyle={{gap: GAP, paddingHorizontal: PADDING_H}}
                        contentContainerStyle={{paddingBottom: 24, rowGap: GAP}}
                        onRefresh={refresh}
                        refreshing={false}
                    />
                )}
            </View>
        </ThemedView>
    );
}

const styles = StyleSheet.create({
    cardBody: {
        marginBottom: 16,
    },
    preview: {
        width: '100%',
        aspectRatio: 1,
        borderRadius: 8,
        backgroundColor: '#0b0b0b',
    },
    placeholder: {
        width: '100%',
        aspectRatio: 1,
        backgroundColor: '#e5e7eb',
        borderRadius: 8,
    },
});
